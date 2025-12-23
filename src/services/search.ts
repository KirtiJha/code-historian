/**
 * Enhanced Hybrid Search Engine for Code Historian
 * Combines vector similarity search with keyword-based search using:
 * - Score normalization (min-max scaling)
 * - Reciprocal Rank Fusion (RRF)
 * - Optional cross-encoder reranking
 */

import type {
  SearchQuery,
  SearchResult,
  SearchFilters,
  SearchHighlight,
  HybridSearchParams,
  ChangeRecord,
  VectorSearchResult,
} from '../types';
import { VectorStore } from '../database/vectorStore';
import { MetadataDatabase } from '../database/metadata';
import { EmbeddingService } from './embedding';
import { RerankerService, prepareDocumentForReranking, RerankerDocument } from './reranker';
import { eventEmitter } from '../utils/events';
import { logger } from '../utils/logger';
import { EVENTS, SEARCH_DEFAULTS, RERANKER_DEFAULTS } from '../constants';
import { parseTimeExpression, extractFilePatterns } from '../utils';

interface RankedResult {
  changeId: string;
  vectorRank?: number;
  keywordRank?: number;
  vectorScore?: number;
  keywordScore?: number;
  normalizedVectorScore?: number;
  normalizedKeywordScore?: number;
  rrfScore: number;
  rerankerScore?: number;
}

interface NormalizedScores {
  results: Array<{ id: string; score: number; normalizedScore: number }>;
  min: number;
  max: number;
}

export class SearchEngine {
  private vectorStore: VectorStore;
  private metadataDb: MetadataDatabase;
  private embeddingService: EmbeddingService;
  private reranker: RerankerService;
  private workspaceId: string;
  private useReranker: boolean = false;

  constructor(
    vectorStore: VectorStore,
    metadataDb: MetadataDatabase,
    embeddingService: EmbeddingService,
    workspaceId: string,
    reranker?: RerankerService
  ) {
    this.vectorStore = vectorStore;
    this.metadataDb = metadataDb;
    this.embeddingService = embeddingService;
    this.workspaceId = workspaceId;
    this.reranker = reranker ?? new RerankerService();
  }

  /**
   * Enable/disable reranker
   */
  setRerankerEnabled(enabled: boolean, apiKey?: string): void {
    this.useReranker = enabled;
    if (apiKey) {
      this.reranker.updateConfig({ apiKey });
    }
    this.reranker.setEnabled(enabled);
    logger.info(`Reranker ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Update reranker configuration
   */
  updateRerankerConfig(config: {
    provider?: 'huggingface' | 'cohere';
    model?: string;
    apiKey?: string;
  }): void {
    this.reranker.updateConfig(config);
  }

  /**
   * Perform hybrid search combining vector and keyword search
   * Pipeline: Query -> Vector Search + Keyword Search -> Score Normalization -> RRF Fusion -> Reranking -> Results
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    const startTime = Date.now();

    try {
      // Parse and enrich filters from natural language
      const enrichedFilters = this.enrichFilters(query.naturalLanguage, query.filters);

      // Get hybrid params with defaults
      const hybridParams: HybridSearchParams = {
        vectorWeight: query.hybridParams?.vectorWeight ?? SEARCH_DEFAULTS.VECTOR_WEIGHT,
        keywordWeight: query.hybridParams?.keywordWeight ?? SEARCH_DEFAULTS.KEYWORD_WEIGHT,
        rerankTopK: query.hybridParams?.rerankTopK ?? SEARCH_DEFAULTS.RERANK_TOP_K,
      };

      logger.debug('Starting hybrid search', {
        query: query.naturalLanguage.slice(0, 50),
        vectorWeight: hybridParams.vectorWeight,
        keywordWeight: hybridParams.keywordWeight,
        useReranker: this.useReranker,
      });

      // Execute searches in parallel
      const [vectorResults, keywordResults] = await Promise.all([
        this.vectorSearch(query.naturalLanguage, hybridParams.rerankTopK, enrichedFilters),
        this.keywordSearch(query.naturalLanguage, hybridParams.rerankTopK),
      ]);

      logger.debug('Search results', {
        vectorCount: vectorResults.length,
        keywordCount: keywordResults.length,
      });

      // Normalize scores for better fusion
      const normalizedVector = this.normalizeScores(
        vectorResults.map(r => ({ id: r.changeId, score: r.score })),
        SEARCH_DEFAULTS.MIN_VECTOR_SCORE
      );
      const normalizedKeyword = this.normalizeScores(
        keywordResults.map(r => ({ id: r.change.id, score: r.rank })),
        SEARCH_DEFAULTS.MIN_KEYWORD_SCORE
      );

      // Combine and rerank using Reciprocal Rank Fusion
      const rankedResults = this.reciprocalRankFusion(
        vectorResults,
        keywordResults,
        hybridParams,
        normalizedVector,
        normalizedKeyword
      );

      // Apply cross-encoder reranking if enabled
      let finalRanked = rankedResults;
      if (this.useReranker && this.reranker.isEnabled() && rankedResults.length > 0) {
        finalRanked = await this.applyReranking(query.naturalLanguage, rankedResults);
      }

      // Fetch full change records
      const results = await this.hydrateResults(
        finalRanked,
        query.naturalLanguage,
        SEARCH_DEFAULTS.MAX_RESULTS
      );

      const duration = Date.now() - startTime;
      logger.debug(`Search completed in ${duration}ms, found ${results.length} results`);

      eventEmitter.emit(EVENTS.SEARCH_COMPLETED, results);

      return results;
    } catch (error) {
      logger.error('Search failed', error as Error);
      throw error;
    }
  }

  /**
   * Normalize scores to 0-1 range using min-max scaling
   * This ensures fair combination of vector and keyword scores
   */
  private normalizeScores(
    results: Array<{ id: string; score: number }>,
    minThreshold: number = 0
  ): NormalizedScores {
    if (results.length === 0) {
      return { results: [], min: 0, max: 0 };
    }

    const scores = results.map(r => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min;

    const normalized = results.map(r => ({
      id: r.id,
      score: r.score,
      normalizedScore: range > 0 ? (r.score - min) / range : 1,
    }));

    // Filter by threshold after normalization
    const filtered = normalized.filter(r => r.normalizedScore >= minThreshold);

    return { results: filtered, min, max };
  }

  /**
   * Apply cross-encoder reranking to improve result quality
   */
  private async applyReranking(
    query: string,
    rankedResults: RankedResult[]
  ): Promise<RankedResult[]> {
    try {
      // Prepare documents for reranking
      const documents: RerankerDocument[] = [];

      for (const result of rankedResults.slice(0, RERANKER_DEFAULTS.TOP_K)) {
        const change = this.metadataDb.getChange(result.changeId);
        if (change) {
          documents.push({
            id: result.changeId,
            text: prepareDocumentForReranking(change),
            originalScore: result.rrfScore,
          });
        }
      }

      if (documents.length === 0) {
        return rankedResults;
      }

      // Rerank using cross-encoder
      const reranked = await this.reranker.rerank(query, documents, SEARCH_DEFAULTS.MAX_RESULTS);

      // Map reranker scores back to ranked results
      const rerankerScoreMap = new Map(reranked.map(r => [r.id, r.score]));

      // Update results with reranker scores and re-sort
      const updatedResults = rankedResults.map(r => ({
        ...r,
        rerankerScore: rerankerScoreMap.get(r.changeId),
      }));

      // Sort by reranker score if available, otherwise by RRF score
      updatedResults.sort((a, b) => {
        if (a.rerankerScore !== undefined && b.rerankerScore !== undefined) {
          return b.rerankerScore - a.rerankerScore;
        }
        return b.rrfScore - a.rrfScore;
      });

      logger.debug('Reranking applied', {
        originalTop: rankedResults[0]?.changeId,
        rerankedTop: updatedResults[0]?.changeId,
      });

      return updatedResults;
    } catch (error) {
      logger.warn('Reranking failed, using original order', error as Error);
      return rankedResults;
    }
  }

  /**
   * Vector-based semantic search
   */
  private async vectorSearch(
    query: string,
    topK: number,
    filters?: SearchFilters
  ): Promise<VectorSearchResult[]> {
    try {
      // Generate query embedding
      const queryVector = await this.embeddingService.embedQuery(query);

      // Search vector store
      const results = await this.vectorStore.search(queryVector, topK, filters);

      return results;
    } catch (error) {
      logger.warn('Vector search failed, falling back to keyword only', error as Error);
      return [];
    }
  }

  /**
   * Keyword-based full-text search
   */
  private async keywordSearch(
    query: string,
    topK: number
  ): Promise<Array<{ change: ChangeRecord; rank: number }>> {
    try {
      // Prepare FTS query (escape special characters)
      const ftsQuery = this.prepareFTSQuery(query);

      // Search metadata database
      const results = this.metadataDb.searchChanges(this.workspaceId, ftsQuery, topK);

      return results;
    } catch (error) {
      logger.warn('Keyword search failed', error as Error);
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF) for combining search results
   * Enhanced with score normalization for better fusion quality
   *
   * Formula: score = sum(weight * 1 / (k + rank)) for each ranking
   *
   * With normalized scores, we also compute a weighted average:
   * combinedScore = vectorWeight * normVectorScore + keywordWeight * normKeywordScore
   */
  private reciprocalRankFusion(
    vectorResults: VectorSearchResult[],
    keywordResults: Array<{ change: ChangeRecord; rank: number }>,
    params: HybridSearchParams,
    normalizedVector: NormalizedScores,
    normalizedKeyword: NormalizedScores
  ): RankedResult[] {
    const k = SEARCH_DEFAULTS.RRF_K;
    const scoreMap = new Map<string, RankedResult>();

    // Create lookup maps for normalized scores
    const normalizedVectorMap = new Map(
      normalizedVector.results.map(r => [r.id, r.normalizedScore])
    );
    const normalizedKeywordMap = new Map(
      normalizedKeyword.results.map(r => [r.id, r.normalizedScore])
    );

    // Process vector results
    vectorResults.forEach((result, index) => {
      const rank = index + 1;
      const rrfContribution = params.vectorWeight * (1 / (k + rank));
      const normalizedScore = normalizedVectorMap.get(result.changeId) ?? 0;

      scoreMap.set(result.changeId, {
        changeId: result.changeId,
        vectorRank: rank,
        vectorScore: result.score,
        normalizedVectorScore: normalizedScore,
        rrfScore: rrfContribution,
      });
    });

    // Process keyword results
    keywordResults.forEach((result, index) => {
      const rank = index + 1;
      const rrfContribution = params.keywordWeight * (1 / (k + rank));
      const normalizedScore = normalizedKeywordMap.get(result.change.id) ?? 0;

      const existing = scoreMap.get(result.change.id);
      if (existing) {
        existing.keywordRank = rank;
        existing.keywordScore = Math.abs(result.rank);
        existing.normalizedKeywordScore = normalizedScore;
        existing.rrfScore += rrfContribution;
      } else {
        scoreMap.set(result.change.id, {
          changeId: result.change.id,
          keywordRank: rank,
          keywordScore: Math.abs(result.rank),
          normalizedKeywordScore: normalizedScore,
          rrfScore: rrfContribution,
        });
      }
    });

    // Boost score for documents appearing in both results (reciprocal boosting)
    for (const [, result] of scoreMap) {
      if (result.vectorRank && result.keywordRank) {
        // Boost by up to 20% for documents in both result sets
        const overlapBoost =
          1 +
          0.2 *
            Math.min(1, (result.normalizedVectorScore ?? 0) * (result.normalizedKeywordScore ?? 0));
        result.rrfScore *= overlapBoost;
      }
    }

    // Sort by combined RRF score
    const ranked = Array.from(scoreMap.values());
    ranked.sort((a, b) => b.rrfScore - a.rrfScore);

    return ranked;
  }

  /**
   * Fetch full change records and create search results
   */
  private async hydrateResults(
    rankedResults: RankedResult[],
    query: string,
    limit: number
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const queryTerms = this.extractQueryTerms(query);

    for (const ranked of rankedResults.slice(0, limit)) {
      const change = this.metadataDb.getChange(ranked.changeId);

      if (change) {
        const highlights = this.generateHighlights(change, queryTerms);

        results.push({
          change,
          score: ranked.rrfScore,
          vectorScore: ranked.vectorScore,
          keywordScore: ranked.keywordScore,
          highlights,
        });
      }
    }

    return results;
  }

  /**
   * Generate highlights for search result
   */
  private generateHighlights(change: ChangeRecord, queryTerms: string[]): SearchHighlight[] {
    const highlights: SearchHighlight[] = [];

    // Check file path
    const pathMatches = queryTerms.filter(term =>
      change.filePath.toLowerCase().includes(term.toLowerCase())
    );
    if (pathMatches.length > 0) {
      highlights.push({
        field: 'filePath',
        snippet: change.filePath,
        matchedTerms: pathMatches,
      });
    }

    // Check symbols
    const symbolMatches = change.symbols.filter(symbol =>
      queryTerms.some(term => symbol.toLowerCase().includes(term.toLowerCase()))
    );
    if (symbolMatches.length > 0) {
      highlights.push({
        field: 'symbols',
        snippet: symbolMatches.join(', '),
        matchedTerms: symbolMatches,
      });
    }

    // Check diff
    const diffLines = change.diff.split('\n');
    const matchingLines = diffLines
      .filter(line => queryTerms.some(term => line.toLowerCase().includes(term.toLowerCase())))
      .slice(0, 5);

    if (matchingLines.length > 0) {
      highlights.push({
        field: 'diff',
        snippet: matchingLines.join('\n'),
        matchedTerms: queryTerms.filter(term =>
          matchingLines.some(line => line.toLowerCase().includes(term.toLowerCase()))
        ),
      });
    }

    // Check summary
    if (change.summary) {
      const summaryMatches = queryTerms.filter(term =>
        change.summary!.toLowerCase().includes(term.toLowerCase())
      );
      if (summaryMatches.length > 0) {
        highlights.push({
          field: 'summary',
          snippet: change.summary,
          matchedTerms: summaryMatches,
        });
      }
    }

    return highlights;
  }

  /**
   * Prepare query for FTS5
   */
  private prepareFTSQuery(query: string): string {
    // Remove special FTS5 characters and create prefix search
    const cleaned = query
      .replace(/['"*()^-]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(term => term.length > 1)
      .map(term => `"${term}"*`)
      .join(' OR ');

    return cleaned || query;
  }

  /**
   * Extract query terms for highlighting
   */
  private extractQueryTerms(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2);
  }

  /**
   * Enrich filters with parsed information from natural language
   */
  private enrichFilters(query: string, filters?: SearchFilters): SearchFilters {
    const enriched: SearchFilters = { ...filters };

    // Parse time expressions
    const timeRange = parseTimeExpression(query);
    if (timeRange && !enriched.timeRange) {
      enriched.timeRange = timeRange;
    }

    // Extract file patterns
    const filePatterns = extractFilePatterns(query);
    if (filePatterns.length > 0) {
      enriched.filePatterns = [...(enriched.filePatterns || []), ...filePatterns];
    }

    return enriched;
  }

  /**
   * Search for similar changes
   */
  async findSimilar(changeId: string, topK: number = 10): Promise<SearchResult[]> {
    // Get the change
    const change = this.metadataDb.getChange(changeId);
    if (!change) {
      throw new Error(`Change not found: ${changeId}`);
    }

    // Get its embedding
    const vectorRecord = await this.vectorStore.getVectorByChangeId(changeId);
    if (!vectorRecord) {
      throw new Error(`No embedding found for change: ${changeId}`);
    }

    // Search for similar vectors
    const similar = await this.vectorStore.search(vectorRecord.vector, topK + 1);

    // Filter out the original change and hydrate results
    const filtered = similar.filter(r => r.changeId !== changeId);
    const results: SearchResult[] = [];

    for (const result of filtered.slice(0, topK)) {
      const relatedChange = this.metadataDb.getChange(result.changeId);
      if (relatedChange) {
        results.push({
          change: relatedChange,
          score: result.score,
          vectorScore: result.score,
        });
      }
    }

    return results;
  }

  /**
   * Get timeline of changes for a file
   */
  getFileTimeline(filePath: string, limit: number = 100): ChangeRecord[] {
    return this.metadataDb.getChanges(this.workspaceId, { filePatterns: [filePath] }, limit);
  }

  /**
   * Get timeline of changes for a symbol
   */
  async getSymbolTimeline(symbol: string, limit: number = 100): Promise<ChangeRecord[]> {
    // Search for changes mentioning the symbol
    const results = this.metadataDb.searchChanges(this.workspaceId, `symbols:${symbol}`, limit);

    return results.map(r => r.change);
  }

  /**
   * Analyze patterns in changes
   */
  async analyzePatterns(timeRange?: { start: number; end: number }): Promise<{
    frequentFiles: Array<{ path: string; count: number }>;
    frequentSymbols: Array<{ symbol: string; count: number }>;
    activityByHour: Array<{ hour: number; count: number }>;
    changeTypes: Array<{ type: string; count: number }>;
  }> {
    const changes = this.metadataDb.getChanges(
      this.workspaceId,
      timeRange ? { timeRange } : undefined,
      10000
    );

    // Analyze file frequency
    const fileCounts = new Map<string, number>();
    const symbolCounts = new Map<string, number>();
    const hourCounts = new Map<number, number>();
    const typeCounts = new Map<string, number>();

    for (const change of changes) {
      // File frequency
      fileCounts.set(change.filePath, (fileCounts.get(change.filePath) || 0) + 1);

      // Symbol frequency
      for (const symbol of change.symbols) {
        symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
      }

      // Activity by hour
      const hour = new Date(change.timestamp).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);

      // Change types
      typeCounts.set(change.eventType, (typeCounts.get(change.eventType) || 0) + 1);
    }

    return {
      frequentFiles: Array.from(fileCounts.entries())
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      frequentSymbols: Array.from(symbolCounts.entries())
        .map(([symbol, count]) => ({ symbol, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      activityByHour: Array.from(hourCounts.entries())
        .map(([hour, count]) => ({ hour, count }))
        .sort((a, b) => a.hour - b.hour),
      changeTypes: Array.from(typeCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
