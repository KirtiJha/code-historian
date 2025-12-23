/**
 * Core types for Code Historian extension
 */

import { z } from 'zod';

// ============================================================================
// Change Events
// ============================================================================

export type ChangeEventType = 'create' | 'modify' | 'delete' | 'rename';

export interface ChangeRecord {
  id: string; // ULID - sortable unique identifier
  timestamp: number; // Unix timestamp in milliseconds
  workspaceId: string; // Hash of workspace root path
  sessionId: string; // Current editing session ID

  // File context
  filePath: string; // Relative to workspace root
  absolutePath: string; // Full filesystem path
  language: string; // Programming language identifier
  fileExtension: string; // File extension

  // Change data
  eventType: ChangeEventType;
  diff: string; // Unified diff format
  diffCompressed?: Buffer; // Gzip compressed diff for storage
  linesAdded: number;
  linesDeleted: number;
  totalLines: number;

  // Content context
  contentBefore?: string; // Content before change
  contentAfter?: string; // Content after change
  contextLines: string[]; // Surrounding context (5 lines before/after)

  // Semantic analysis
  symbols: string[]; // Functions, classes, variables modified
  imports: string[]; // Import statements affected
  activeFunction?: string; // Function being edited
  activeClass?: string; // Class being edited

  // Git integration
  gitBranch?: string;
  gitCommit?: string; // Associated commit if committed
  gitAuthor?: string;

  // Embedding & Search
  embeddingId?: string; // Reference to vector in LanceDB
  summary?: string; // LLM-generated summary
  searchableText: string; // Combined text for full-text search

  // Metadata
  metadata: ChangeMetadata;
}

export interface ChangeMetadata {
  editorVersion: string;
  extensionVersion: string;
  os: string;
  hostname?: string;
  isAutoSave: boolean;
  triggerKind: 'manual' | 'auto' | 'undo' | 'redo' | 'paste' | 'typing';
}

// ============================================================================
// Session Management
// ============================================================================

export interface Session {
  id: string;
  workspaceId: string;
  startTime: number;
  endTime?: number;
  isActive: boolean;
  totalChanges: number;
  filesModified: string[];
  summary?: string;
}

// ============================================================================
// Embedding Types
// ============================================================================

export type EmbeddingProvider = 'ollama' | 'openai' | 'huggingface' | 'local';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  endpoint?: string;
  apiKey?: string;
  batchSize: number;
  maxTokens: number;
}

export interface EmbeddingRecord {
  id: string;
  changeId: string;
  vector: number[];
  model: string;
  createdAt: number;
}

// ============================================================================
// LLM Types
// ============================================================================

export type LLMProvider = 'openai' | 'anthropic' | 'ollama' | 'google';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchQuery {
  naturalLanguage: string;
  filters?: SearchFilters;
  hybridParams?: HybridSearchParams;
}

export interface SearchFilters {
  timeRange?: {
    start: number;
    end: number;
  };
  filePatterns?: string[];
  languages?: string[];
  eventTypes?: ChangeEventType[];
  symbols?: string[];
  branches?: string[];
  sessions?: string[];
}

export interface HybridSearchParams {
  vectorWeight: number; // 0-1, weight for semantic search
  keywordWeight: number; // 0-1, weight for keyword search
  rerankTopK: number; // Number of candidates for reranking
}

export interface SearchResult {
  change: ChangeRecord;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
  highlights?: SearchHighlight[];
}

export interface SearchHighlight {
  field: string;
  snippet: string;
  matchedTerms: string[];
}

// ============================================================================
// Vector Store Types
// ============================================================================

export interface VectorRecord {
  id: string;
  changeId: string;
  vector: number[];
  timestamp: number;
  filePath: string;
  eventType: string;
  language: string;
  symbols: string[];
  searchableText: string;
  summary?: string;
}

export interface VectorSearchResult {
  id: string;
  changeId: string;
  score: number;
  distance: number;
}

// ============================================================================
// Restoration Types
// ============================================================================

export interface RestoreRequest {
  changeId: string;
  targetPath?: string; // Optional different target path
  createBranch?: boolean;
  branchName?: string;
  dryRun?: boolean;
}

export interface RestoreResult {
  success: boolean;
  changeId: string;
  filePath: string;
  linesRestored: number;
  backupCreated: boolean;
  branchCreated?: string;
  error?: string;
}

export interface ImpactAnalysis {
  filesAffected: number;
  linesChanged: number;
  symbolsAffected: string[];
  potentialConflicts: ConflictInfo[];
  summary: string;
  risk: 'low' | 'medium' | 'high';
}

export interface ConflictInfo {
  filePath: string;
  lineRange: [number, number];
  description: string;
}

// ============================================================================
// Configuration Schema
// ============================================================================

export const CaptureConfigSchema = z.object({
  enabled: z.boolean().default(true),
  debounceMs: z.number().min(500).max(30000).default(2000),
  maxHistoryDays: z.number().min(7).max(365).default(90),
  excludePatterns: z.array(z.string()).default([]),
  includePatterns: z.array(z.string()).default([]),
  maxFileSizeKB: z.number().min(64).max(10240).default(1024),
});

export const EmbeddingConfigSchema = z.object({
  provider: z.enum(['ollama', 'openai', 'huggingface']).default('ollama'),
  model: z.string().default('nomic-embed-text'),
  dimensions: z.number().default(768),
  ollamaEndpoint: z.string().default('http://localhost:11434'),
  huggingfaceModel: z.string().default('BAAI/bge-large-en-v1.5'),
});

export const LLMConfigSchema = z.object({
  provider: z
    .enum(['openai', 'anthropic', 'ollama', 'google', 'azure', 'groq', 'mistral', 'cohere'])
    .default('ollama'),
  model: z.string().default('llama3.2'),
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().min(256).max(128000).default(4096),
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  googleApiKey: z.string().optional(),
  azureEndpoint: z.string().optional(),
  azureApiKey: z.string().optional(),
  azureDeployment: z.string().optional(),
  groqApiKey: z.string().optional(),
  mistralApiKey: z.string().optional(),
  cohereApiKey: z.string().optional(),
  ollamaEndpoint: z.string().default('http://localhost:11434'),
});

export const SearchConfigSchema = z.object({
  vectorWeight: z.number().min(0).max(1).default(0.7),
  keywordWeight: z.number().min(0).max(1).default(0.3),
  maxResults: z.number().min(5).max(100).default(20),
  rerankTopK: z.number().min(10).max(200).default(50),
});

export const StorageConfigSchema = z.object({
  path: z.string().optional(),
  maxSizeMB: z.number().min(100).max(10240).default(1024),
});

export const UIConfigSchema = z.object({
  theme: z.enum(['auto', 'light', 'dark']).default('auto'),
  compactMode: z.boolean().default(false),
  showInlineHistory: z.boolean().default(true),
});

export const ExtensionConfigSchema = z.object({
  capture: CaptureConfigSchema,
  embedding: EmbeddingConfigSchema,
  llm: LLMConfigSchema,
  search: SearchConfigSchema,
  storage: StorageConfigSchema,
  ui: UIConfigSchema,
});

export type CaptureConfig = z.infer<typeof CaptureConfigSchema>;
export type ExtensionConfig = z.infer<typeof ExtensionConfigSchema>;

// ============================================================================
// Event Types
// ============================================================================

export interface ExtensionEvents {
  onChangeCapture: (change: ChangeRecord) => void;
  onSessionStart: (session: Session) => void;
  onSessionEnd: (session: Session) => void;
  onSearchComplete: (results: SearchResult[]) => void;
  onRestoreComplete: (result: RestoreResult) => void;
  onConfigChange: (config: Partial<ExtensionConfig>) => void;
  onError: (error: Error, context: string) => void;
}

// ============================================================================
// Webview Message Types
// ============================================================================

export type WebviewMessageType =
  | 'ready'
  | 'search'
  | 'getTimeline'
  | 'getChangeDetails'
  | 'restore'
  | 'compare'
  | 'openFile'
  | 'openSettings'
  | 'exportHistory'
  | 'clearHistory'
  | 'getStats'
  | 'getConfig'
  | 'updateConfig';

export interface WebviewMessage<T = unknown> {
  type: WebviewMessageType;
  id: string; // Request ID for response correlation
  payload: T;
}

export interface WebviewResponse<T = unknown> {
  type: 'response' | 'error' | 'event';
  id: string;
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Chat Participant Types
// ============================================================================

export type ChatIntent =
  | 'search'
  | 'restore'
  | 'compare'
  | 'explain'
  | 'timeline'
  | 'similar'
  | 'patterns'
  | 'unknown';

export interface ParsedIntent {
  intent: ChatIntent;
  query: string;
  filters: SearchFilters;
  confidence: number;
}

// ============================================================================
// Statistics Types
// ============================================================================

export interface HistoryStats {
  totalChanges: number;
  totalFiles: number;
  totalSessions: number;
  totalLinesChanged: number;
  oldestChange: number;
  newestChange: number;
  topLanguages: Array<{ language: string; count: number }>;
  topFiles: Array<{ filePath: string; count: number }>;
  changesByDay: Array<{ date: string; count: number }>;
  storageUsedMB: number;
}

// ============================================================================
// Tree-sitter Types
// ============================================================================

export interface CodeSymbol {
  name: string;
  kind: 'function' | 'class' | 'method' | 'variable' | 'import' | 'interface' | 'type';
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  parent?: string;
}

export interface ParsedCode {
  language: string;
  symbols: CodeSymbol[];
  imports: string[];
  exports: string[];
}
