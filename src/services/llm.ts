/**
 * LLM Orchestrator for Code Historian
 * Multi-provider LLM integration with streaming support
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import type { LLMConfig, LLMMessage, LLMResponse, LLMProvider, ChangeRecord } from '../types';
import { logger } from '../utils/logger';
import { LLM_MODELS } from '../constants';

/**
 * Base interface for LLM providers
 */
interface ILLMProvider {
  chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse>;
  streamChat(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<string>;
  isAvailable(): Promise<boolean>;
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

/**
 * OpenAI Provider Implementation
 */
class OpenAIProvider implements ILLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
      stop: options?.stop,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      model: this.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      finishReason: response.choices[0]?.finish_reason || undefined,
    };
  }

  async *streamChat(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
      stop: options?.stop,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Anthropic Provider Implementation
 */
class AnthropicProvider implements ILLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
    // Separate system message
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: systemMessage?.content,
      messages: chatMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    const content = response.content[0];
    return {
      content: content.type === 'text' ? content.text : '',
      model: this.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason || undefined,
    };
  }

  async *streamChat(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<string> {
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: systemMessage?.content,
      messages: chatMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Simple test call
      await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Ollama Provider Implementation
 */
class OllamaProvider implements ILLMProvider {
  private endpoint: string;
  private model: string;

  constructor(endpoint: string, model: string) {
    this.endpoint = endpoint;
    this.model = model;
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        options: {
          temperature: options?.temperature ?? 0.3,
          num_predict: options?.maxTokens ?? 4096,
        },
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama chat failed: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      message: { content: string };
      model: string;
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      content: data.message.content,
      model: data.model,
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    };
  }

  async *streamChat(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<string> {
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        options: {
          temperature: options?.temperature ?? 0.3,
          num_predict: options?.maxTokens ?? 4096,
        },
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama streaming failed: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          const data = JSON.parse(line) as { message?: { content: string }; done: boolean };
          if (data.message?.content) {
            yield data.message.content;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Google Gemini Provider Implementation
 */
class GoogleProvider implements ILLMProvider {
  private client: GoogleGenerativeAI;
  private model: GenerativeModel;
  private modelName: string;

  constructor(apiKey: string, model: string) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = this.client.getGenerativeModel({ model });
    this.modelName = model;
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
    // Convert messages to Gemini format
    const systemInstruction = messages.find(m => m.role === 'system')?.content;
    const chatMessages = messages.filter(m => m.role !== 'system');

    const chat = this.model.startChat({
      history: chatMessages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: options?.temperature ?? 0.3,
        maxOutputTokens: options?.maxTokens ?? 4096,
      },
    });

    const lastMessage = chatMessages[chatMessages.length - 1];
    const prompt = systemInstruction
      ? `${systemInstruction}\n\n${lastMessage.content}`
      : lastMessage.content;

    const result = await chat.sendMessage(prompt);
    const response = result.response;

    return {
      content: response.text(),
      model: this.modelName,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
      },
    };
  }

  async *streamChat(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<string> {
    const systemInstruction = messages.find(m => m.role === 'system')?.content;
    const chatMessages = messages.filter(m => m.role !== 'system');

    const chat = this.model.startChat({
      history: chatMessages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: options?.temperature ?? 0.3,
        maxOutputTokens: options?.maxTokens ?? 4096,
      },
    });

    const lastMessage = chatMessages[chatMessages.length - 1];
    const prompt = systemInstruction
      ? `${systemInstruction}\n\n${lastMessage.content}`
      : lastMessage.content;

    const result = await chat.sendMessageStream(prompt);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield text;
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.model.generateContent('Hi');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Main LLM Orchestrator
 */
export class LLMOrchestrator {
  private providers: Map<LLMProvider, ILLMProvider> = new Map();
  private config: LLMConfig;
  private activeProvider: LLMProvider;

  constructor(config: LLMConfig) {
    this.config = config;
    this.activeProvider = config.provider;
    this.initializeProvider(config.provider);
  }

  /**
   * Initialize a provider
   */
  private initializeProvider(provider: LLMProvider): void {
    if (this.providers.has(provider)) {
      return;
    }

    try {
      let llmProvider: ILLMProvider;

      switch (provider) {
        case 'openai':
          if (!this.config.apiKey) {
            throw new Error('OpenAI API key required');
          }
          llmProvider = new OpenAIProvider(this.config.apiKey, this.config.model);
          break;

        case 'anthropic':
          if (!this.config.apiKey) {
            throw new Error('Anthropic API key required');
          }
          llmProvider = new AnthropicProvider(this.config.apiKey, this.config.model);
          break;

        case 'ollama':
          llmProvider = new OllamaProvider(
            this.config.endpoint || 'http://localhost:11434',
            this.config.model
          );
          break;

        case 'google':
          if (!this.config.apiKey) {
            throw new Error('Google API key required');
          }
          llmProvider = new GoogleProvider(this.config.apiKey, this.config.model);
          break;

        default:
          throw new Error(`Unsupported LLM provider: ${provider}`);
      }

      this.providers.set(provider, llmProvider);
      logger.info(`LLM provider initialized: ${provider}`);
    } catch (error) {
      logger.error(`Failed to initialize LLM provider: ${provider}`, error as Error);
      throw error;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LLMConfig>): void {
    const providerChanged = config.provider && config.provider !== this.config.provider;
    const apiKeyChanged = config.apiKey !== undefined && config.apiKey !== this.config.apiKey;
    const modelChanged = config.model !== undefined && config.model !== this.config.model;

    // If provider changed, we need to make sure we're using the new provider's API key
    // The incoming config might have the new provider but the old API key if not fully populated
    // However, in extension.ts we are calling getLLMConfig() which should have the correct key

    this.config = { ...this.config, ...config };

    // Force re-initialization if provider, API key, or model changed
    if (providerChanged || apiKeyChanged || modelChanged) {
      const provider = this.config.provider; // Use the updated config provider
      this.activeProvider = provider;

      // If provider changed, we should clear the old provider instance
      // If only API key changed, we also need to clear to force re-creation with new key
      this.providers.delete(provider);

      logger.info(
        `Re-initializing LLM provider ${provider} due to config change (Provider: ${providerChanged}, API Key: ${apiKeyChanged}, Model: ${modelChanged})`
      );
      this.initializeProvider(provider);
    }
  }

  /**
   * Set active provider
   */
  setActiveProvider(provider: LLMProvider): void {
    this.activeProvider = provider;
    this.initializeProvider(provider);
  }

  /**
   * Get current provider
   */
  getActiveProvider(): ILLMProvider {
    const provider = this.providers.get(this.activeProvider);
    if (!provider) {
      this.initializeProvider(this.activeProvider);
      return this.providers.get(this.activeProvider)!;
    }
    return provider;
  }

  /**
   * Chat with context
   */
  async chat(messages: LLMMessage[], context?: ChangeRecord[]): Promise<LLMResponse> {
    const provider = this.getActiveProvider();
    const augmentedMessages = context ? this.buildRAGPrompt(messages, context) : messages;

    return provider.chat(augmentedMessages, {
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });
  }

  /**
   * Stream chat with context
   */
  async *streamChat(messages: LLMMessage[], context?: ChangeRecord[]): AsyncIterable<string> {
    const provider = this.getActiveProvider();
    const augmentedMessages = context ? this.buildRAGPrompt(messages, context) : messages;

    yield* provider.streamChat(augmentedMessages, {
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });
  }

  /**
   * Build RAG prompt with context
   */
  private buildRAGPrompt(messages: LLMMessage[], context: ChangeRecord[]): LLMMessage[] {
    const systemPrompt = `You are Code Historian, an AI assistant helping developers understand and navigate their code change history.

You have access to the developer's code change history through a RAG (Retrieval Augmented Generation) system. When answering questions:
1. Base your answers on the retrieved context provided
2. Be specific and reference actual file names, functions, and code snippets
3. If asked to restore code, explain what will change and ask for confirmation
4. If the context doesn't contain relevant information, say so

Retrieved Context (${context.length} relevant changes):
${context.map((c, i) => this.formatChangeForContext(c, i + 1)).join('\n\n---\n\n')}

Remember to be helpful, accurate, and concise.`;

    // Find existing system message or create one
    const existingSystem = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const combinedSystem = existingSystem
      ? `${systemPrompt}\n\nAdditional Instructions: ${existingSystem.content}`
      : systemPrompt;

    return [{ role: 'system', content: combinedSystem }, ...otherMessages];
  }

  /**
   * Format a change record for context
   */
  private formatChangeForContext(change: ChangeRecord, index: number): string {
    const timestamp = new Date(change.timestamp).toLocaleString();
    const parts = [
      `[Change ${index}]`,
      `File: ${change.filePath}`,
      `Time: ${timestamp}`,
      `Type: ${change.eventType}`,
      `Lines: +${change.linesAdded}/-${change.linesDeleted}`,
    ];

    if (change.symbols.length > 0) {
      parts.push(`Symbols: ${change.symbols.join(', ')}`);
    }

    if (change.gitBranch) {
      parts.push(`Branch: ${change.gitBranch}`);
    }

    if (change.summary) {
      parts.push(`Summary: ${change.summary}`);
    }

    // Add truncated diff
    const maxDiffLines = 20;
    const diffLines = change.diff.split('\n');
    const truncatedDiff =
      diffLines.length > maxDiffLines
        ? [
            ...diffLines.slice(0, maxDiffLines),
            `... (${diffLines.length - maxDiffLines} more lines)`,
          ].join('\n')
        : change.diff;

    parts.push(`Diff:\n${truncatedDiff}`);

    return parts.join('\n');
  }

  /**
   * Generate summary for a change
   */
  async generateSummary(change: ChangeRecord): Promise<string> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content:
          'You are a code change summarizer. Generate a brief, one-line summary of the code change. Focus on what was changed and why it might have been done. Be concise.',
      },
      {
        role: 'user',
        content: `Summarize this code change:

File: ${change.filePath}
Type: ${change.eventType}
Diff:
${change.diff}`,
      },
    ];

    const response = await this.chat(messages);
    return response.content.trim();
  }

  /**
   * Check if active provider is available
   */
  async isAvailable(): Promise<boolean> {
    const provider = this.getActiveProvider();
    return provider.isAvailable();
  }

  /**
   * Get available models for a provider
   */
  getAvailableModels(provider: LLMProvider): string[] {
    return [...(LLM_MODELS[provider] || [])];
  }

  /**
   * Get all supported providers
   */
  getSupportedProviders(): LLMProvider[] {
    return ['openai', 'anthropic', 'ollama', 'google'];
  }
}
