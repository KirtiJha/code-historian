/**
 * Webview Types
 * Shared types between extension and webview
 */

// Message types from extension to webview
export type ExtensionToWebviewMessage =
  | { type: 'timeline'; data: TimelineData }
  | { type: 'changeDetails'; data: ChangeDetailsData }
  | { type: 'searchResults'; data: SearchResultsData }
  | { type: 'settings'; data: SettingsData }
  | { type: 'status'; data: StatusData }
  | { type: 'diff'; data: DiffData }
  | { type: 'toast'; data: ToastData }
  | { type: 'loading'; data: { loading: boolean; message?: string } }
  | { type: 'error'; data: { message: string; details?: string } }
  | { type: 'testConnectionResult'; data: TestConnectionResultData }
  | { type: 'chatResponse'; data: ChatResponseData }
  | { type: 'chatResponseChunk'; data: { chunk: string } }
  | { type: 'chatResponseEnd'; data: { query: string } };

// Message types from webview to extension
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'getTimeline'; data: TimelineRequest }
  | { type: 'getChangeDetails'; data: { changeId: string } }
  | { type: 'search'; data: SearchRequest }
  | { type: 'restore'; data: RestoreRequest }
  | { type: 'previewRestore'; data: { changeId: string } }
  | { type: 'getSettings' }
  | { type: 'updateSettings'; data: Partial<SettingsData> }
  | { type: 'exportHistory'; data: ExportRequest }
  | { type: 'clearHistory' }
  | { type: 'openFile'; data: { filePath: string; line?: number } }
  | { type: 'chat'; data: { message: string } }
  | { type: 'refresh' }
  | { type: 'testConnection'; data: { provider: 'embedding' | 'llm' } };

// Timeline data structures
export interface TimelineData {
  changes: TimelineChange[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  groupedByDate: Record<string, TimelineChange[]>;
}

export interface TimelineChange {
  id: string;
  timestamp: number;
  filePath: string;
  fileName: string;
  changeType: 'create' | 'modify' | 'delete' | 'rename';
  language: string;
  linesAdded: number;
  linesRemoved: number;
  summary?: string;
  symbols?: string[];
  branch?: string;
  commitHash?: string;
  sessionId?: string;
  tags: string[];
}

export interface TimelineRequest {
  page?: number;
  pageSize?: number;
  filePath?: string;
  dateFrom?: number;
  dateTo?: number;
  changeTypes?: string[];
  languages?: string[];
  searchQuery?: string;
}

// Change details
export interface ChangeDetailsData {
  change: TimelineChange;
  diff: DiffData;
  context: {
    previousChange?: TimelineChange;
    nextChange?: TimelineChange;
    relatedChanges: TimelineChange[];
  };
  metadata: {
    fileSize: number;
    totalLines?: number;
    encoding: string;
    eol: string;
    absolutePath?: string;
    gitAuthor?: string;
    activeFunction?: string;
    activeClass?: string;
  };
}

// Test connection result
export interface TestConnectionResultData {
  success: boolean;
  provider: 'embedding' | 'llm';
  message: string;
}

// Chat response data for AI-powered answers
export interface ChatResponseData {
  query: string;
  response: string;
  sources: Array<{
    changeId: string;
    filePath: string;
    timestamp: number;
    score: number;
  }>;
  isStreaming?: boolean;
}

// Diff data
export interface DiffData {
  oldContent: string;
  newContent: string;
  rawDiff?: string; // Unified diff string from git-style diff
  hunks: DiffHunk[];
  stats: {
    additions: number;
    deletions: number;
    changes: number;
  };
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

// Search
export interface SearchRequest {
  query: string;
  filters?: {
    files?: string[];
    languages?: string[];
    dateFrom?: number;
    dateTo?: number;
    changeTypes?: string[];
    symbols?: string[];
  };
  limit?: number;
}

export interface SearchResultsData {
  results: SearchResult[];
  total: number;
  query: string;
  executionTime: number;
}

export interface SearchResult {
  change: TimelineChange;
  score: number;
  highlights: {
    field: string;
    matches: string[];
  }[];
  snippet?: string;
}

// Restore
export interface RestoreRequest {
  changeId: string;
  targetPath?: string;
  createBackup?: boolean;
}

// Settings
export interface SettingsData {
  // Capture settings
  capture: {
    enabled: boolean;
    autoCapture: boolean;
    debounceMs: number;
    excludePatterns: string[];
    maxFileSizeKb: number;
  };
  // Embedding settings
  embedding: {
    provider: 'huggingface' | 'ollama' | 'openai';
    model: string;
    batchSize: number;
    ollamaUrl?: string;
    openaiApiKey?: string;
    huggingfaceApiKey?: string;
  };
  // LLM settings
  llm: {
    provider: 'openai' | 'anthropic' | 'ollama' | 'google';
    model: string;
    apiKey?: string;
    baseUrl?: string;
    temperature: number;
    maxTokens: number;
    streaming?: boolean;
    ollamaUrl?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
  };
  // Storage settings
  storage: {
    maxChanges: number;
    retentionDays: number;
    compressionEnabled: boolean;
  };
  // UI settings
  ui: {
    theme: 'auto' | 'light' | 'dark';
    compactMode?: boolean;
    showLineNumbers?: boolean;
    diffStyle?: 'split' | 'unified' | 'inline';
    timelineGroupBy?: 'date' | 'file' | 'session';
    defaultPageSize?: number;
    showPreviewOnHover?: boolean;
  };
}

// Status
export interface StatusData {
  indexing: {
    active: boolean;
    progress: number;
    currentFile?: string;
    totalFiles: number;
    processedFiles: number;
  };
  stats: {
    totalChanges: number;
    totalFiles: number;
    totalSessions: number;
    storageUsedMb: number;
    lastCaptureTime?: number;
  };
  health: {
    database: 'ok' | 'error' | 'initializing';
    vectorStore: 'ok' | 'error' | 'initializing';
    embedding: 'ok' | 'error' | 'not-configured';
    llm: 'ok' | 'error' | 'not-configured';
  };
}

// Export
export interface ExportRequest {
  format: 'json' | 'markdown' | 'html';
  dateFrom?: number;
  dateTo?: number;
  files?: string[];
  includeContent?: boolean;
  includeDiffs?: boolean;
}

// Toast notifications
export interface ToastData {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  duration?: number;
  action?: {
    label: string;
    command: string;
  };
}

// Theme
export interface Theme {
  name: string;
  colors: {
    background: string;
    foreground: string;
    primary: string;
    secondary: string;
    accent: string;
    error: string;
    warning: string;
    success: string;
    info: string;
    border: string;
    muted: string;
    mutedForeground: string;
    card: string;
    cardForeground: string;
    popover: string;
    popoverForeground: string;
  };
  fonts: {
    sans: string;
    mono: string;
  };
}

// Component props
export interface TimelineProps {
  data: TimelineData;
  onSelect: (change: TimelineChange) => void;
  onLoadMore: () => void;
  onFilter: (filters: TimelineRequest) => void;
  loading?: boolean;
}

export interface DiffViewerProps {
  data: DiffData;
  splitView?: boolean;
  highlightChanges?: boolean;
  showLineNumbers?: boolean;
}

export interface SearchBoxProps {
  onSearch: (query: string, filters?: SearchRequest['filters']) => void;
  placeholder?: string;
  loading?: boolean;
}

export interface SettingsPanelProps {
  settings: SettingsData;
  onUpdate: (settings: Partial<SettingsData>) => void;
  onReset: () => void;
}
