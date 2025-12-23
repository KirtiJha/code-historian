/**
 * Cross-Encoder Reranker Service for Code Historian
 * Uses open-source cross-encoder models for improved search ranking
 *
 * Supported reranker models:
 * - BAAI/bge-reranker-base (fast, good quality)
 * - BAAI/bge-reranker-large (slower, better quality)
 * - cross-encoder/ms-marco-MiniLM-L-6-v2 (fast, English)
 */

import { logger } from '../utils/logger';
import { RERANKER_MODELS, PERFORMANCE } from '../constants';

export interface RerankerDocument {
  id: string;
  text: string;
  originalScore?: number;
}

export interface RerankedResult {
  id: string;
  score: number;
  originalScore?: number;
}

export interface RerankerConfig {
  provider: 'huggingface' | 'local' | 'cohere';
  model: string;
  apiKey?: string;
  topK: number;
}

export class RerankerService {
  private config: RerankerConfig;
  private enabled: boolean = true;

  constructor(config?: Partial<RerankerConfig>) {
    this.config = {
      provider: config?.provider ?? 'huggingface',
      model: config?.model ?? RERANKER_MODELS.BGE_BASE,
      apiKey: config?.apiKey,
      topK: config?.topK ?? 10,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RerankerConfig>): void {
    Object.assign(this.config, config);
    logger.info('Reranker config updated', { model: this.config.model });
  }

  /**
   * Enable/disable reranker
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if reranker is available and enabled
   */
  isEnabled(): boolean {
    return this.enabled && !!this.config.apiKey;
  }

  /**
   * Rerank documents using cross-encoder model
   */
  async rerank(
    query: string,
    documents: RerankerDocument[],
    topK?: number
  ): Promise<RerankedResult[]> {
    if (!this.enabled || documents.length === 0) {
      return documents.map(doc => ({
        id: doc.id,
        score: doc.originalScore ?? 0,
        originalScore: doc.originalScore,
      }));
    }

    const limit = topK ?? this.config.topK;

    try {
      switch (this.config.provider) {
        case 'huggingface':
          return await this.rerankWithHuggingFace(query, documents, limit);
        case 'cohere':
          return await this.rerankWithCohere(query, documents, limit);
        case 'local':
          // Future: Local cross-encoder implementation
          logger.warn('Local reranker not yet implemented, using passthrough');
          return this.passthroughRerank(documents, limit);
        default:
          return this.passthroughRerank(documents, limit);
      }
    } catch (error) {
      logger.error('Reranking failed, using original scores', error as Error);
      return this.passthroughRerank(documents, limit);
    }
  }

  /**
   * Rerank using HuggingFace Inference API with cross-encoder
   * Cross-encoders need text pairs - we use the sentence-similarity pipeline
   */
  private async rerankWithHuggingFace(
    query: string,
    documents: RerankerDocument[],
    topK: number
  ): Promise<RerankedResult[]> {
    if (!this.config.apiKey) {
      logger.warn('HuggingFace API key not set for reranker');
      return this.passthroughRerank(documents, topK);
    }

    const model = this.config.model;
    // Use the router endpoint (api-inference is deprecated)
    const url = `https://router.huggingface.co/hf-inference/models/${model}`;

    try {
      const scores: number[] = [];

      // Process each document - cross-encoders work on pairs
      for (const doc of documents) {
        try {
          // Cross-encoders expect text pairs for classification
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              inputs: {
                text: query,
                text_pair: doc.text.slice(0, 512), // Truncate to avoid token limits
              },
            }),
            signal: AbortSignal.timeout(PERFORMANCE.EMBEDDING_TIMEOUT_MS),
          });

          if (!response.ok) {
            // Try alternative format with [SEP] token
            const altResponse = await fetch(url, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                inputs: `${query} [SEP] ${doc.text.slice(0, 512)}`,
              }),
              signal: AbortSignal.timeout(PERFORMANCE.EMBEDDING_TIMEOUT_MS),
            });

            if (!altResponse.ok) {
              const errorText = await altResponse.text();
              logger.debug(`Reranker API error for doc: ${altResponse.status} - ${errorText}`);
              scores.push(doc.originalScore ?? 0);
              continue;
            }

            const altResult = await altResponse.json();
            const score = this.extractScoreFromResult(altResult);
            scores.push(score ?? doc.originalScore ?? 0);
          } else {
            const result = await response.json();
            const score = this.extractScoreFromResult(result);
            scores.push(score ?? doc.originalScore ?? 0);
          }
        } catch (docError) {
          logger.debug(`Error scoring document: ${(docError as Error).message}`);
          scores.push(doc.originalScore ?? 0);
        }
      }

      // Combine with original documents and sort by reranker score
      const reranked = documents.map((doc, idx) => ({
        id: doc.id,
        score: scores[idx] ?? 0,
        originalScore: doc.originalScore,
      }));

      // Sort by reranker score descending
      reranked.sort((a, b) => b.score - a.score);

      return reranked.slice(0, topK);
    } catch (error) {
      logger.warn('HuggingFace reranker failed', error as Error);
      return this.passthroughRerank(documents, topK);
    }
  }

  /**
   * Extract score from various HuggingFace response formats
   */
  private extractScoreFromResult(result: unknown): number | null {
    if (typeof result === 'number') {
      return result;
    }

    if (Array.isArray(result)) {
      if (result.length === 0) return null;
      const first = result[0];

      if (typeof first === 'number') return first;

      // Handle text-classification output: [[{label, score}, ...]]
      if (Array.isArray(first)) {
        // Find the positive/relevant label score (LABEL_1 typically means relevant)
        const positive = first.find(
          (item: { label?: string; score?: number }) =>
            item.label === 'LABEL_1' || item.label === 'entailment' || item.label === '1'
        );
        if (positive?.score !== undefined) return positive.score;
        // Fall back to first item's score
        if (first[0]?.score !== undefined) return first[0].score;
      }

      if (first?.score !== undefined) return first.score;
    }

    if (result && typeof result === 'object' && 'score' in result) {
      return (result as { score: number }).score;
    }

    return null;
  }

  /**
   * Rerank using Cohere Rerank API
   * https://docs.cohere.com/reference/rerank
   */
  private async rerankWithCohere(
    query: string,
    documents: RerankerDocument[],
    topK: number
  ): Promise<RerankedResult[]> {
    if (!this.config.apiKey) {
      logger.warn('Cohere API key not set for reranker');
      return this.passthroughRerank(documents, topK);
    }

    const url = 'https://api.cohere.ai/v1/rerank';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model || 'rerank-english-v3.0',
          query: query,
          documents: documents.map(doc => doc.text),
          top_n: topK,
          return_documents: false,
        }),
        signal: AbortSignal.timeout(PERFORMANCE.EMBEDDING_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cohere reranker API error: ${response.status} - ${errorText}`);
      }

      const result = (await response.json()) as {
        results: Array<{ index: number; relevance_score: number }>;
      };

      // Cohere returns: { results: [{index, relevance_score}] }
      const reranked: RerankedResult[] = result.results.map(
        (r: { index: number; relevance_score: number }) => ({
          id: documents[r.index].id,
          score: r.relevance_score,
          originalScore: documents[r.index].originalScore,
        })
      );

      return reranked;
    } catch (error) {
      logger.warn('Cohere reranker failed', error as Error);
      return this.passthroughRerank(documents, topK);
    }
  }

  /**
   * Passthrough reranking - just return original scores sorted
   */
  private passthroughRerank(documents: RerankerDocument[], topK: number): RerankedResult[] {
    return documents
      .map(doc => ({
        id: doc.id,
        score: doc.originalScore ?? 0,
        originalScore: doc.originalScore,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Calculate normalized score (0-1 range)
   */
  normalizeScores(results: RerankedResult[]): RerankedResult[] {
    if (results.length === 0) return [];

    const scores = results.map(r => r.score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore;

    if (range === 0) {
      return results.map(r => ({ ...r, score: 1 }));
    }

    return results.map(r => ({
      ...r,
      score: (r.score - minScore) / range,
    }));
  }
}

/**
 * Utility function to prepare document text for reranking
 */
export function prepareDocumentForReranking(change: {
  filePath: string;
  diff: string;
  summary?: string;
  symbols: string[];
}): string {
  const parts: string[] = [];

  // Include file path
  parts.push(`File: ${change.filePath}`);

  // Include symbols
  if (change.symbols.length > 0) {
    parts.push(`Symbols: ${change.symbols.join(', ')}`);
  }

  // Include summary if available
  if (change.summary) {
    parts.push(`Summary: ${change.summary}`);
  }

  // Include truncated diff (first 500 chars)
  const diffPreview = change.diff.slice(0, 500);
  if (diffPreview) {
    parts.push(`Changes: ${diffPreview}`);
  }

  return parts.join('\n');
}
