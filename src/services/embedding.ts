/**
 * Embedding Service for Code Historian
 * Handles generating embeddings using various providers
 */

import type { EmbeddingConfig, ChangeRecord, VectorRecord } from '../types';
import { VectorStore } from '../database/vectorStore';
import { MetadataDatabase } from '../database/metadata';
import { eventEmitter } from '../utils/events';
import { logger } from '../utils/logger';
import { EVENTS, PERFORMANCE, EMBEDDING_MODELS } from '../constants';
import { batchArray, retry, generateContentHash } from '../utils';

/**
 * Base interface for embedding providers
 */
interface IEmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getModelInfo(): { dimensions: number; maxTokens: number };
}

/**
 * Ollama embedding provider
 */
class OllamaEmbeddingProvider implements IEmbeddingProvider {
  private endpoint: string;
  private model: string;
  private dimensions: number;
  private maxTokens: number;

  constructor(endpoint: string, model: string) {
    this.endpoint = endpoint;
    this.model = model;

    const modelConfig = EMBEDDING_MODELS.ollama[model as keyof typeof EMBEDDING_MODELS.ollama];
    this.dimensions = modelConfig?.dimensions || 768;
    this.maxTokens = modelConfig?.maxTokens || 8192;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.endpoint}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.statusText}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't support batch embedding, so we parallelize
    const results = await Promise.all(texts.map(text => this.embed(text)));
    return results;
  }

  getModelInfo() {
    return { dimensions: this.dimensions, maxTokens: this.maxTokens };
  }
}

/**
 * OpenAI embedding provider
 */
class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private maxTokens: number;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;

    const modelConfig = EMBEDDING_MODELS.openai[model as keyof typeof EMBEDDING_MODELS.openai];
    this.dimensions = modelConfig?.dimensions || 1536;
    this.maxTokens = modelConfig?.maxTokens || 8191;
  }

  async embed(text: string): Promise<number[]> {
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${error}`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map(d => d.embedding);
  }

  getModelInfo() {
    return { dimensions: this.dimensions, maxTokens: this.maxTokens };
  }
}

/**
 * HuggingFace Inference API embedding provider
 */
class HuggingFaceEmbeddingProvider implements IEmbeddingProvider {
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private maxTokens: number;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;

    const modelConfig =
      EMBEDDING_MODELS.huggingface[model as keyof typeof EMBEDDING_MODELS.huggingface];
    this.dimensions = modelConfig?.dimensions || 768;
    this.maxTokens = modelConfig?.maxTokens || 512;
  }

  async embed(text: string): Promise<number[]> {
    const url = `https://router.huggingface.co/hf-inference/models/${this.model}`;
    logger.debug(
      `HuggingFace embed request to ${url}, text length: ${text.length}, apiKey present: ${!!this.apiKey}`
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        inputs: text,
        options: { wait_for_model: true },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HuggingFace embedding failed (${response.status}): ${error}`);
    }

    const data = (await response.json()) as number[];
    logger.debug(
      `HuggingFace embed response received, data type: ${typeof data}, isArray: ${Array.isArray(data)}`
    );
    // HuggingFace returns nested array, need to mean pool
    return this.meanPool(data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(
      `https://router.huggingface.co/hf-inference/models/${this.model}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          inputs: texts,
          options: { wait_for_model: true },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HuggingFace embedding failed: ${error}`);
    }

    const data = (await response.json()) as number[][];
    return data.map(d => this.meanPool(d));
  }

  private meanPool(embedding: number[] | number[][]): number[] {
    if (!Array.isArray(embedding[0])) {
      return embedding as number[];
    }

    // Mean pooling for token embeddings
    const tokens = embedding as number[][];
    const dimensions = tokens[0].length;
    const result = new Array(dimensions).fill(0);

    for (const token of tokens) {
      for (let i = 0; i < dimensions; i++) {
        result[i] += token[i];
      }
    }

    return result.map(v => v / tokens.length);
  }

  getModelInfo() {
    return { dimensions: this.dimensions, maxTokens: this.maxTokens };
  }
}

/**
 * Main Embedding Service
 */
export class EmbeddingService {
  private provider: IEmbeddingProvider | null = null;
  private config: EmbeddingConfig;
  private vectorStore: VectorStore;
  private metadataDb: MetadataDatabase;
  private embeddingCache: Map<string, number[]> = new Map();
  private isProcessing: boolean = false;

  constructor(config: EmbeddingConfig, vectorStore: VectorStore, metadataDb: MetadataDatabase) {
    this.config = config;
    this.vectorStore = vectorStore;
    this.metadataDb = metadataDb;
  }

  /**
   * Initialize the embedding service with provider
   */
  async initialize(): Promise<void> {
    try {
      this.provider = this.createProvider();
      logger.info(
        `Embedding service initialized with ${this.config.provider}/${this.config.model}`
      );
    } catch (error) {
      // If provider creation fails (e.g., missing API key), log warning but don't fail
      // User can configure API key in settings later
      logger.warn(`Embedding service initialization deferred: ${(error as Error).message}`);
      logger.info('Embeddings will be available once provider is properly configured in settings');
      this.provider = null;
    }
  }

  /**
   * Create embedding provider based on config
   */
  private createProvider(): IEmbeddingProvider {
    switch (this.config.provider) {
      case 'ollama':
        return new OllamaEmbeddingProvider(
          this.config.endpoint || 'http://localhost:11434',
          this.config.model
        );

      case 'openai':
        if (!this.config.apiKey) {
          throw new Error('OpenAI API key required - configure in Settings > Embedding');
        }
        return new OpenAIEmbeddingProvider(this.config.apiKey, this.config.model);

      case 'huggingface':
        if (!this.config.apiKey) {
          throw new Error('HuggingFace API key required - configure in Settings > Embedding');
        }
        return new HuggingFaceEmbeddingProvider(this.config.apiKey, this.config.model);

      default:
        // Fall back to Ollama as default local provider
        logger.warn(`Unknown provider "${this.config.provider}", falling back to Ollama`);
        return new OllamaEmbeddingProvider(
          this.config.endpoint || 'http://localhost:11434',
          'nomic-embed-text'
        );
    }
  }

  /**
   * Check if provider is properly configured
   */
  isConfigured(): boolean {
    return this.provider !== null;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<EmbeddingConfig>): void {
    this.config = { ...this.config, ...config };
    try {
      this.provider = this.createProvider();
      logger.info(`Embedding config updated: ${this.config.provider}/${this.config.model}`);
    } catch (error) {
      logger.warn(`Failed to update embedding config: ${(error as Error).message}`);
      this.provider = null;
    }
  }

  /**
   * Generate embedding for text
   */
  async embed(text: string): Promise<number[]> {
    if (!this.provider) {
      throw new Error(
        `Embedding provider not configured. Please configure your ${this.config.provider} API key in Settings > Embedding Settings.`
      );
    }

    // Check cache
    const cacheKey = generateContentHash(text);
    const cached = this.embeddingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Generate embedding with retry
    const embedding = await retry(() => this.provider!.embed(text), 3, 1000);

    // Cache result
    this.embeddingCache.set(cacheKey, embedding);

    // Limit cache size
    if (this.embeddingCache.size > 1000) {
      const firstKey = this.embeddingCache.keys().next().value;
      if (firstKey) {
        this.embeddingCache.delete(firstKey);
      }
    }

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.provider) {
      throw new Error('Embedding service not initialized');
    }

    return retry(() => this.provider!.embedBatch(texts), 3, 1000);
  }

  /**
   * Process a change record and store embedding
   */
  async processChange(change: ChangeRecord): Promise<string> {
    // Create embedding text from change
    const embeddingText = this.createEmbeddingText(change);

    // Generate embedding
    const vector = await this.embed(embeddingText);

    // Create vector record
    const vectorRecord: VectorRecord = {
      id: '', // Will be assigned by vector store
      changeId: change.id,
      vector,
      timestamp: change.timestamp,
      filePath: change.filePath,
      eventType: change.eventType,
      language: change.language,
      symbols: change.symbols,
      searchableText: change.searchableText,
      summary: change.summary,
    };

    // Store in vector database
    const embeddingId = await this.vectorStore.addVector(vectorRecord);

    // Update metadata database
    this.metadataDb.updateEmbeddingId(change.id, embeddingId);

    eventEmitter.emit(EVENTS.EMBEDDING_COMPLETED, { changeId: change.id, embeddingId });

    return embeddingId;
  }

  /**
   * Process multiple changes in batch
   */
  async processChanges(changes: ChangeRecord[]): Promise<void> {
    if (this.isProcessing) {
      logger.warn('Already processing changes, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      const batches = batchArray(changes, this.config.batchSize);
      let processed = 0;

      for (const batch of batches) {
        // Create embedding texts
        const texts = batch.map(change => this.createEmbeddingText(change));

        // Generate embeddings in batch
        const embeddings = await this.embedBatch(texts);

        // Create vector records
        const vectorRecords: VectorRecord[] = batch.map((change, i) => ({
          id: '',
          changeId: change.id,
          vector: embeddings[i],
          timestamp: change.timestamp,
          filePath: change.filePath,
          eventType: change.eventType,
          language: change.language,
          symbols: change.symbols,
          searchableText: change.searchableText,
          summary: change.summary,
        }));

        // Store in vector database
        const embeddingIds = await this.vectorStore.addVectors(vectorRecords);

        // Update metadata database
        for (let i = 0; i < batch.length; i++) {
          this.metadataDb.updateEmbeddingId(batch[i].id, embeddingIds[i]);
        }

        processed += batch.length;
        logger.debug(`Processed ${processed}/${changes.length} embeddings`);
      }

      eventEmitter.emit(EVENTS.INDEX_UPDATED, {
        count: changes.length,
        duration: Date.now(),
      });

      logger.info(`Processed ${changes.length} change embeddings`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process pending changes (those without embeddings)
   */
  async processPendingChanges(workspaceId: string): Promise<number> {
    const pendingChanges = this.metadataDb.getChangesWithoutEmbeddings(
      workspaceId,
      PERFORMANCE.BATCH_COMMIT_SIZE
    );

    if (pendingChanges.length === 0) {
      return 0;
    }

    await this.processChanges(pendingChanges);
    return pendingChanges.length;
  }

  /**
   * Create embedding text from change record
   */
  private createEmbeddingText(change: ChangeRecord): string {
    const parts: string[] = [];

    // Add file context
    parts.push(`File: ${change.filePath}`);
    parts.push(`Language: ${change.language}`);
    parts.push(`Event: ${change.eventType}`);

    // Add symbols if available
    if (change.symbols.length > 0) {
      parts.push(`Symbols: ${change.symbols.join(', ')}`);
    }

    // Add summary if available
    if (change.summary) {
      parts.push(`Summary: ${change.summary}`);
    }

    // Add diff (truncated if necessary)
    const maxDiffLength = this.config.maxTokens * 4 - parts.join('\n').length - 100;
    let diff = change.diff;
    if (diff.length > maxDiffLength) {
      diff = diff.substring(0, maxDiffLength) + '\n... [truncated]';
    }
    parts.push(`Changes:\n${diff}`);

    return parts.join('\n');
  }

  /**
   * Generate embedding for search query
   */
  async embedQuery(query: string): Promise<number[]> {
    // Add query prefix for better retrieval (some models benefit from this)
    const queryText = `search query: ${query}`;
    return this.embed(queryText);
  }

  /**
   * Get model information
   */
  getModelInfo(): { dimensions: number; maxTokens: number } {
    if (!this.provider) {
      return { dimensions: this.config.dimensions, maxTokens: 512 };
    }
    return this.provider.getModelInfo();
  }

  /**
   * Check if provider is available
   */
  async checkAvailability(): Promise<boolean> {
    try {
      await this.embed('test');
      return true;
    } catch (error) {
      logger.warn(`Embedding provider not available: ${error}`);
      return false;
    }
  }

  /**
   * Clear embedding cache
   */
  clearCache(): void {
    this.embeddingCache.clear();
    logger.debug('Embedding cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.embeddingCache.size,
      maxSize: 1000,
    };
  }
}
