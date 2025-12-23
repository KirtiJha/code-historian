/**
 * Chat Participant for Code Historian
 * Provides conversational interface through VS Code Chat API
 */

import * as vscode from 'vscode';
import type { ChatIntent, ParsedIntent, SearchFilters, ChangeRecord, LLMMessage } from '../types';
import { SearchEngine } from '../services/search';
import { LLMOrchestrator } from '../services/llm';
import { RestorationEngine } from '../services/restoration';
import { logger } from '../utils/logger';
import { CHAT_COMMANDS } from '../constants';
import { parseTimeExpression, extractFilePatterns, formatRelativeTime } from '../utils';

const PARTICIPANT_ID = 'codeHistorian.chat';
// const PARTICIPANT_NAME = 'historian'; // Unused

interface ChatCommand {
  name: string;
  description: string;
  handler: (
    query: string,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ) => Promise<void>;
}

export class ChatParticipant {
  private participant: vscode.ChatParticipant;
  private searchEngine: SearchEngine;
  private llmOrchestrator: LLMOrchestrator;
  private restorationEngine: RestorationEngine;
  private commands: Map<string, ChatCommand> = new Map();

  constructor(
    context: vscode.ExtensionContext,
    searchEngine: SearchEngine,
    llmOrchestrator: LLMOrchestrator,
    restorationEngine: RestorationEngine
  ) {
    this.searchEngine = searchEngine;
    this.llmOrchestrator = llmOrchestrator;
    this.restorationEngine = restorationEngine;

    // Create chat participant
    this.participant = vscode.chat.createChatParticipant(
      PARTICIPANT_ID,
      this.handleChat.bind(this)
    );

    this.participant.iconPath = new vscode.ThemeIcon('history');

    // Register commands
    this.registerCommands();

    context.subscriptions.push(this.participant);
  }

  /**
   * Register chat commands
   */
  private registerCommands(): void {
    this.commands.set(CHAT_COMMANDS.SEARCH, {
      name: 'search',
      description: 'Search code history',
      handler: this.handleSearch.bind(this),
    });

    this.commands.set(CHAT_COMMANDS.RESTORE, {
      name: 'restore',
      description: 'Restore code from history',
      handler: this.handleRestore.bind(this),
    });

    this.commands.set(CHAT_COMMANDS.COMPARE, {
      name: 'compare',
      description: 'Compare code versions',
      handler: this.handleCompare.bind(this),
    });

    this.commands.set(CHAT_COMMANDS.EXPLAIN, {
      name: 'explain',
      description: 'Explain code changes',
      handler: this.handleExplain.bind(this),
    });

    this.commands.set(CHAT_COMMANDS.TIMELINE, {
      name: 'timeline',
      description: 'Show timeline for file or symbol',
      handler: this.handleTimeline.bind(this),
    });

    this.commands.set(CHAT_COMMANDS.SIMILAR, {
      name: 'similar',
      description: 'Find similar changes',
      handler: this.handleSimilar.bind(this),
    });

    this.commands.set(CHAT_COMMANDS.PATTERNS, {
      name: 'patterns',
      description: 'Analyze change patterns',
      handler: this.handlePatterns.bind(this),
    });
  }

  /**
   * Main chat handler
   */
  private async handleChat(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    try {
      // Check for explicit command
      if (request.command) {
        const command = this.commands.get(request.command);
        if (command) {
          await command.handler(request.prompt, context, stream, token);
          return { metadata: { command: request.command } };
        }
      }

      // Parse intent from natural language
      const intent = this.parseIntent(request.prompt);
      
      // Route to appropriate handler
      switch (intent.intent) {
        case 'search':
          await this.handleSearch(request.prompt, context, stream, token);
          break;
        case 'restore':
          await this.handleRestore(request.prompt, context, stream, token);
          break;
        case 'compare':
          await this.handleCompare(request.prompt, context, stream, token);
          break;
        case 'explain':
          await this.handleExplain(request.prompt, context, stream, token);
          break;
        case 'timeline':
          await this.handleTimeline(request.prompt, context, stream, token);
          break;
        case 'similar':
          await this.handleSimilar(request.prompt, context, stream, token);
          break;
        case 'patterns':
          await this.handlePatterns(request.prompt, context, stream, token);
          break;
        default:
          await this.handleGeneralQuery(request.prompt, context, stream, token);
      }

      return { metadata: { intent: intent.intent } };
    } catch (error) {
      logger.error('Chat handler error', error as Error);
      stream.markdown(`❌ Error: ${(error as Error).message}`);
      return { metadata: { error: true } };
    }
  }

  /**
   * Parse user intent from natural language
   */
  private parseIntent(query: string): ParsedIntent {
    const lowerQuery = query.toLowerCase();

    // Intent detection patterns
    const patterns: Array<{ pattern: RegExp; intent: ChatIntent }> = [
      { pattern: /\b(restore|revert|undo|bring back|rollback)\b/i, intent: 'restore' },
      { pattern: /\b(compare|diff|difference|versus|vs)\b/i, intent: 'compare' },
      { pattern: /\b(explain|why|what happened|describe|tell me about)\b/i, intent: 'explain' },
      { pattern: /\b(timeline|history of|changes to|evolution)\b/i, intent: 'timeline' },
      { pattern: /\b(similar|like this|related|same pattern)\b/i, intent: 'similar' },
      { pattern: /\b(pattern|frequent|often|usually|trend)\b/i, intent: 'patterns' },
      { pattern: /\b(search|find|look for|where|when|show me)\b/i, intent: 'search' },
    ];

    for (const { pattern, intent } of patterns) {
      if (pattern.test(lowerQuery)) {
        return {
          intent,
          query,
          filters: this.extractFilters(query),
          confidence: 0.8,
        };
      }
    }

    // Default to search
    return {
      intent: 'search',
      query,
      filters: this.extractFilters(query),
      confidence: 0.5,
    };
  }

  /**
   * Extract filters from natural language
   */
  private extractFilters(query: string): SearchFilters {
    const filters: SearchFilters = {};

    // Time range
    const timeRange = parseTimeExpression(query);
    if (timeRange) {
      filters.timeRange = timeRange;
    }

    // File patterns
    const filePatterns = extractFilePatterns(query);
    if (filePatterns.length > 0) {
      filters.filePatterns = filePatterns;
    }

    // Event types
    if (/\b(created?|added?|new)\b/i.test(query)) {
      filters.eventTypes = ['create'];
    } else if (/\b(deleted?|removed?)\b/i.test(query)) {
      filters.eventTypes = ['delete'];
    } else if (/\b(renamed?|moved?)\b/i.test(query)) {
      filters.eventTypes = ['rename'];
    } else if (/\b(modified?|changed?|updated?)\b/i.test(query)) {
      filters.eventTypes = ['modify'];
    }

    return filters;
  }

  /**
   * Handle search command
   */
  private async handleSearch(
    query: string,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    stream.progress('Searching code history...');

    const results = await this.searchEngine.search({
      naturalLanguage: query,
      hybridParams: { vectorWeight: 0.7, keywordWeight: 0.3, rerankTopK: 50 },
    });

    if (results.length === 0) {
      stream.markdown('No matching changes found in your history.');
      return;
    }

    stream.markdown(`Found **${results.length}** relevant changes:\n\n`);

    for (let i = 0; i < Math.min(results.length, 5); i++) {
      if (token.isCancellationRequested) {break;}
      
      const result = results[i];
      this.renderChangeResult(stream, result.change, i + 1, result.score);
    }

    if (results.length > 5) {
      stream.markdown(`\n*... and ${results.length - 5} more results*\n`);
    }

    // Add action buttons
    stream.button({
      command: 'codeHistorian.openTimeline',
      title: '📊 View Timeline',
    });

    // Use LLM to provide summary
    const changeContext = results.slice(0, 5).map(r => r.change);
    await this.streamLLMResponse(
      query,
      changeContext,
      context,
      stream,
      token
    );
  }

  /**
   * Handle restore command
   */
  private async handleRestore(
    query: string,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken
  ): Promise<void> {
    stream.progress('Finding changes to restore...');

    const results = await this.searchEngine.search({
      naturalLanguage: query,
      hybridParams: { vectorWeight: 0.7, keywordWeight: 0.3, rerankTopK: 20 },
    });

    if (results.length === 0) {
      stream.markdown('No matching changes found to restore.');
      return;
    }

    const topResult = results[0];
    
    stream.markdown(`I found a change that matches your request:\n\n`);
    this.renderChangeResult(stream, topResult.change, 1, topResult.score);

    // Analyze impact
    const impact = await this.restorationEngine.analyzeImpact(topResult.change.id);
    
    stream.markdown(`\n**Impact Analysis:**\n`);
    stream.markdown(`- Files affected: ${impact.filesAffected}\n`);
    stream.markdown(`- Lines to change: ${impact.linesChanged}\n`);
    stream.markdown(`- Risk level: ${impact.risk}\n`);
    stream.markdown(`- ${impact.summary}\n`);

    if (impact.potentialConflicts.length > 0) {
      stream.markdown(`\n⚠️ **Potential Conflicts:**\n`);
      for (const conflict of impact.potentialConflicts) {
        stream.markdown(`- ${conflict.filePath}: ${conflict.description}\n`);
      }
    }

    // Add restore buttons
    stream.button({
      command: 'codeHistorian.restoreChange',
      title: '✅ Restore This Change',
      arguments: [topResult.change.id],
    });

    stream.button({
      command: 'codeHistorian.previewRestore',
      title: '👁️ Preview Restore',
      arguments: [topResult.change.id],
    });

    stream.button({
      command: 'codeHistorian.restoreWithBranch',
      title: '🌿 Restore in New Branch',
      arguments: [topResult.change.id],
    });
  }

  /**
   * Handle compare command
   */
  private async handleCompare(
    query: string,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    stream.progress('Finding changes to compare...');

    const results = await this.searchEngine.search({
      naturalLanguage: query,
      hybridParams: { vectorWeight: 0.7, keywordWeight: 0.3, rerankTopK: 20 },
    });

    if (results.length < 2) {
      stream.markdown('Need at least two changes to compare. Try a more specific query.');
      return;
    }

    const [first, second] = results;

    stream.markdown(`**Comparing two changes:**\n\n`);
    
    stream.markdown(`**Change 1** (${formatRelativeTime(first.change.timestamp)}):\n`);
    this.renderChangeResult(stream, first.change, 1, first.score);

    stream.markdown(`\n**Change 2** (${formatRelativeTime(second.change.timestamp)}):\n`);
    this.renderChangeResult(stream, second.change, 2, second.score);

    // Add compare button
    stream.button({
      command: 'codeHistorian.compareChanges',
      title: '🔍 Open Diff View',
      arguments: [first.change.id, second.change.id],
    });

    // Use LLM to explain differences
    await this.streamLLMResponse(
      `Compare these two changes and explain the differences: ${query}`,
      [first.change, second.change],
      context,
      stream,
      token
    );
  }

  /**
   * Handle explain command
   */
  private async handleExplain(
    query: string,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    stream.progress('Analyzing changes...');

    const results = await this.searchEngine.search({
      naturalLanguage: query,
      hybridParams: { vectorWeight: 0.7, keywordWeight: 0.3, rerankTopK: 10 },
    });

    if (results.length === 0) {
      stream.markdown('No relevant changes found to explain.');
      return;
    }

    const changes = results.slice(0, 5).map(r => r.change);

    stream.markdown(`Analyzing ${changes.length} relevant changes...\n\n`);

    // Use LLM to provide detailed explanation
    await this.streamLLMResponse(
      `Explain in detail: ${query}`,
      changes,
      context,
      stream,
      token
    );
  }

  /**
   * Handle timeline command
   */
  private async handleTimeline(
    query: string,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken
  ): Promise<void> {
    stream.progress('Building timeline...');

    // Extract file path from query
    const filePatterns = extractFilePatterns(query);
    
    let changes: ChangeRecord[];
    
    if (filePatterns.length > 0) {
      changes = this.searchEngine.getFileTimeline(filePatterns[0], 20);
      stream.markdown(`**Timeline for \`${filePatterns[0]}\`:**\n\n`);
    } else {
      const results = await this.searchEngine.search({
        naturalLanguage: query,
        hybridParams: { vectorWeight: 0.7, keywordWeight: 0.3, rerankTopK: 20 },
      });
      changes = results.map(r => r.change);
      stream.markdown(`**Timeline of matching changes:**\n\n`);
    }

    if (changes.length === 0) {
      stream.markdown('No changes found for timeline.');
      return;
    }

    // Render timeline
    for (let i = 0; i < Math.min(changes.length, 10); i++) {
      const change = changes[i];
      const time = formatRelativeTime(change.timestamp);
      const symbol = change.eventType === 'create' ? '🟢' :
                    change.eventType === 'delete' ? '🔴' :
                    change.eventType === 'rename' ? '🔄' : '🔵';
      
      stream.markdown(`${symbol} **${time}** - ${change.filePath}\n`);
      stream.markdown(`   +${change.linesAdded}/-${change.linesDeleted} lines`);
      
      if (change.symbols.length > 0) {
        stream.markdown(` | ${change.symbols.slice(0, 3).join(', ')}`);
      }
      stream.markdown('\n\n');
    }

    stream.button({
      command: 'codeHistorian.openTimeline',
      title: '📊 Open Full Timeline',
    });
  }

  /**
   * Handle similar command
   */
  private async handleSimilar(
    query: string,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken
  ): Promise<void> {
    stream.progress('Finding similar changes...');

    // First find the reference change
    const results = await this.searchEngine.search({
      naturalLanguage: query,
      hybridParams: { vectorWeight: 0.8, keywordWeight: 0.2, rerankTopK: 10 },
    });

    if (results.length === 0) {
      stream.markdown('No matching changes found.');
      return;
    }

    const referenceChange = results[0].change;
    stream.markdown(`**Reference change:**\n`);
    this.renderChangeResult(stream, referenceChange, 0, results[0].score);

    // Find similar changes
    const similar = await this.searchEngine.findSimilar(referenceChange.id, 5);

    if (similar.length === 0) {
      stream.markdown('\nNo similar changes found.');
      return;
    }

    stream.markdown(`\n**Similar changes:**\n\n`);
    
    for (let i = 0; i < similar.length; i++) {
      this.renderChangeResult(stream, similar[i].change, i + 1, similar[i].score);
    }
  }

  /**
   * Handle patterns command
   */
  private async handlePatterns(
    query: string,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    stream.progress('Analyzing patterns...');

    const timeRange = parseTimeExpression(query);
    const patterns = await this.searchEngine.analyzePatterns(timeRange || undefined);

    stream.markdown(`**Change Pattern Analysis**\n\n`);

    // Most changed files
    stream.markdown(`📁 **Most Changed Files:**\n`);
    for (const file of patterns.frequentFiles.slice(0, 5)) {
      stream.markdown(`- \`${file.path}\`: ${file.count} changes\n`);
    }

    // Most active symbols
    if (patterns.frequentSymbols.length > 0) {
      stream.markdown(`\n🔧 **Most Modified Symbols:**\n`);
      for (const symbol of patterns.frequentSymbols.slice(0, 5)) {
        stream.markdown(`- \`${symbol.symbol}\`: ${symbol.count} times\n`);
      }
    }

    // Activity by hour
    stream.markdown(`\n⏰ **Activity by Hour:**\n`);
    const peakHour = patterns.activityByHour.reduce(
      (max, curr) => curr.count > max.count ? curr : max,
      { hour: 0, count: 0 }
    );
    stream.markdown(`Peak activity: ${peakHour.hour}:00 (${peakHour.count} changes)\n`);

    // Change types
    stream.markdown(`\n📊 **Change Types:**\n`);
    for (const type of patterns.changeTypes) {
      const emoji = type.type === 'create' ? '🟢' :
                   type.type === 'delete' ? '🔴' :
                   type.type === 'rename' ? '🔄' : '🔵';
      stream.markdown(`${emoji} ${type.type}: ${type.count}\n`);
    }

    // Use LLM for insights
    stream.markdown(`\n**AI Insights:**\n`);
    await this.streamLLMResponse(
      `Analyze these coding patterns and provide insights: ${JSON.stringify(patterns)}`,
      [],
      context,
      stream,
      token
    );
  }

  /**
   * Handle general query
   */
  private async handleGeneralQuery(
    query: string,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    stream.progress('Searching and analyzing...');

    const results = await this.searchEngine.search({
      naturalLanguage: query,
      hybridParams: { vectorWeight: 0.7, keywordWeight: 0.3, rerankTopK: 20 },
    });

    const changes = results.slice(0, 10).map(r => r.change);

    await this.streamLLMResponse(query, changes, context, stream, token);
  }

  /**
   * Render a change result in chat
   */
  private renderChangeResult(
    stream: vscode.ChatResponseStream,
    change: ChangeRecord,
    index: number,
    score: number
  ): void {
    const time = formatRelativeTime(change.timestamp);
    const scoreStr = (score * 100).toFixed(0);

    stream.markdown(`**${index}. \`${change.filePath}\`** (${scoreStr}% match)\n`);
    stream.markdown(`   📅 ${time} | `);
    stream.markdown(`+${change.linesAdded}/-${change.linesDeleted} lines | `);
    stream.markdown(`${change.eventType}\n`);

    if (change.symbols.length > 0) {
      stream.markdown(`   🔧 ${change.symbols.slice(0, 3).join(', ')}\n`);
    }

    if (change.summary) {
      stream.markdown(`   💬 ${change.summary}\n`);
    }

    stream.markdown('\n');
  }

  /**
   * Stream LLM response with context
   */
  private async streamLLMResponse(
    query: string,
    context: ChangeRecord[],
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Build conversation history
    const messages: LLMMessage[] = [];

    // Add history from chat context
    for (const turn of chatContext.history) {
      if (turn instanceof vscode.ChatRequestTurn) {
        messages.push({ role: 'user', content: turn.prompt });
      } else if (turn instanceof vscode.ChatResponseTurn) {
        // Collect response parts
        let content = '';
        for (const part of turn.response) {
          if (part instanceof vscode.ChatResponseMarkdownPart) {
            content += part.value.value;
          }
        }
        if (content) {
          messages.push({ role: 'assistant', content });
        }
      }
    }

    // Add current query
    messages.push({ role: 'user', content: query });

    // Stream response
    stream.markdown('\n---\n\n');

    try {
      for await (const chunk of this.llmOrchestrator.streamChat(messages, context)) {
        if (token.isCancellationRequested) {
          break;
        }
        stream.markdown(chunk);
      }
    } catch (error) {
      logger.error('LLM streaming error', error as Error);
      stream.markdown(`\n\n⚠️ Could not generate AI response: ${(error as Error).message}`);
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.participant.dispose();
  }
}
