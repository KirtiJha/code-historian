/**
 * Constants for Code Historian extension
 */

export const EXTENSION_ID = 'codeHistorian';
export const EXTENSION_NAME = 'Code Historian';
export const EXTENSION_VERSION = '1.0.0';

// Storage paths
export const DEFAULT_STORAGE_DIR = '.code-historian';
export const METADATA_DB_NAME = 'metadata.db';
export const VECTOR_DB_DIR = 'vectors.lance';
export const DIFFS_DIR = 'diffs';
export const SNAPSHOTS_DIR = 'snapshots';

// Database table names
export const TABLES = {
  CHANGES: 'changes',
  SESSIONS: 'sessions',
  EMBEDDINGS: 'embeddings',
  SETTINGS: 'settings',
  STATS: 'stats',
} as const;

// Embedding model configurations
export const EMBEDDING_MODELS = {
  ollama: {
    'nomic-embed-text': {
      dimensions: 768,
      maxTokens: 8192,
      description: 'Fast, good quality embeddings',
    },
    'mxbai-embed-large': {
      dimensions: 1024,
      maxTokens: 512,
      description: 'High quality embeddings',
    },
    'all-minilm': { dimensions: 384, maxTokens: 256, description: 'Lightweight, fast embeddings' },
    'snowflake-arctic-embed': {
      dimensions: 1024,
      maxTokens: 512,
      description: 'State-of-the-art retrieval',
    },
    'bge-large': { dimensions: 1024, maxTokens: 512, description: 'BGE large model via Ollama' },
  },
  openai: {
    'text-embedding-3-small': {
      dimensions: 1536,
      maxTokens: 8191,
      description: 'Fast, cost-effective',
    },
    'text-embedding-3-large': {
      dimensions: 3072,
      maxTokens: 8191,
      description: 'Highest quality OpenAI',
    },
    'text-embedding-ada-002': { dimensions: 1536, maxTokens: 8191, description: 'Legacy model' },
  },
  huggingface: {
    'BAAI/bge-large-en-v1.5': {
      dimensions: 1024,
      maxTokens: 512,
      description: 'Best quality BGE model (recommended)',
    },
    'BAAI/bge-base-en-v1.5': {
      dimensions: 768,
      maxTokens: 512,
      description: 'Good balance of quality/speed',
    },
    'BAAI/bge-small-en-v1.5': {
      dimensions: 384,
      maxTokens: 512,
      description: 'Fast, lightweight BGE',
    },
    'sentence-transformers/all-MiniLM-L6-v2': {
      dimensions: 384,
      maxTokens: 256,
      description: 'Very fast, lightweight',
    },
    'sentence-transformers/all-mpnet-base-v2': {
      dimensions: 768,
      maxTokens: 384,
      description: 'High quality sentence embeddings',
    },
    'nomic-ai/nomic-embed-text-v1.5': {
      dimensions: 768,
      maxTokens: 8192,
      description: 'Long context support',
    },
    'jinaai/jina-embeddings-v2-base-en': {
      dimensions: 768,
      maxTokens: 8192,
      description: 'Long context, high quality',
    },
  },
} as const;

// Reranker model configurations (Cross-Encoders for improved search)
export const RERANKER_MODELS = {
  // HuggingFace cross-encoder models (free tier available)
  BGE_BASE: 'BAAI/bge-reranker-base', // Fast, good quality (278M params)
  BGE_LARGE: 'BAAI/bge-reranker-large', // Better quality, slower (560M params)
  MS_MARCO_MINI: 'cross-encoder/ms-marco-MiniLM-L-6-v2', // Very fast (22M params)
  MS_MARCO_BASE: 'cross-encoder/ms-marco-TinyBERT-L-2-v2', // Tiny and fast
  // Cohere models (requires API key)
  COHERE_ENGLISH: 'rerank-english-v3.0',
  COHERE_MULTILINGUAL: 'rerank-multilingual-v3.0',
} as const;

// Reranker defaults
export const RERANKER_DEFAULTS = {
  PROVIDER: 'huggingface' as const,
  MODEL: 'BAAI/bge-reranker-base',
  TOP_K: 10,
  ENABLED: true,
} as const;

// LLM model configurations
export const LLM_MODELS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
  anthropic: [
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
    'claude-3-opus-latest',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
  ],
  ollama: [
    'llama3.2',
    'llama3.2:1b',
    'llama3.1',
    'llama3.1:70b',
    'qwen2.5-coder',
    'qwen2.5-coder:14b',
    'qwen2.5-coder:32b',
    'codellama',
    'deepseek-coder-v2',
    'mistral',
    'mixtral',
  ],
  google: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
} as const;

// Default exclude patterns
export const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/coverage/**',
  '**/.nyc_output/**',
  '**/vendor/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/.pytest_cache/**',
  '**/target/**',
  '**/bin/**',
  '**/obj/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/composer.lock',
  '**/Gemfile.lock',
  '**/Cargo.lock',
  '**/poetry.lock',
  '**/.env*',
  '**/*.log',
  '**/*.bak',
  '**/*.tmp',
  '**/*.swp',
  '**/thumbs.db',
  '**/.DS_Store',
];

// Language mappings
export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  // JavaScript/TypeScript
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.mts': 'typescript',
  '.cts': 'typescript',

  // Web
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',

  // Python
  '.py': 'python',
  '.pyw': 'python',
  '.pyx': 'python',
  '.pxd': 'python',
  '.pyi': 'python',

  // Java/JVM
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.groovy': 'groovy',
  '.gradle': 'groovy',

  // C/C++
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',

  // C#/F#
  '.cs': 'csharp',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',

  // Go
  '.go': 'go',

  // Rust
  '.rs': 'rust',

  // Ruby
  '.rb': 'ruby',
  '.erb': 'erb',
  '.rake': 'ruby',

  // PHP
  '.php': 'php',
  '.phtml': 'php',

  // Swift/Objective-C
  '.swift': 'swift',
  '.m': 'objective-c',
  '.mm': 'objective-cpp',

  // Shell
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.fish': 'shellscript',
  '.ps1': 'powershell',
  '.psm1': 'powershell',

  // Config files
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.json5': 'json5',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.ini': 'ini',
  '.conf': 'conf',
  '.properties': 'properties',

  // Markup
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.rst': 'restructuredtext',
  '.tex': 'latex',

  // SQL
  '.sql': 'sql',
  '.pgsql': 'sql',
  '.mysql': 'sql',

  // Other
  '.r': 'r',
  '.R': 'r',
  '.lua': 'lua',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.elm': 'elm',
  '.jl': 'julia',
  '.nim': 'nim',
  '.zig': 'zig',
  '.v': 'v',
  '.sol': 'solidity',
  '.prisma': 'prisma',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',
  '.dockerfile': 'dockerfile',
  '.tf': 'terraform',
  '.tfvars': 'terraform',
};

// Tree-sitter supported languages
export const TREE_SITTER_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'scala',
] as const;

// Rate limiting
export const RATE_LIMITS = {
  EMBEDDING_BATCH_SIZE: 32,
  EMBEDDING_REQUESTS_PER_MINUTE: 100,
  LLM_REQUESTS_PER_MINUTE: 60,
  SEARCH_REQUESTS_PER_SECOND: 10,
} as const;

// Performance thresholds
export const PERFORMANCE = {
  MAX_DIFF_SIZE_BYTES: 100 * 1024, // 100KB
  MAX_FILE_SIZE_BYTES: 1024 * 1024, // 1MB
  MAX_CONTEXT_LINES: 5,
  DEBOUNCE_DEFAULT_MS: 2000,
  BATCH_COMMIT_SIZE: 50,
  BATCH_COMMIT_INTERVAL_MS: 30000,
  EMBEDDING_TIMEOUT_MS: 30000,
  LLM_TIMEOUT_MS: 60000,
  SEARCH_TIMEOUT_MS: 10000,
} as const;

// Search defaults - optimized for hybrid search
export const SEARCH_DEFAULTS = {
  // Hybrid search weights (should sum to 1.0)
  VECTOR_WEIGHT: 0.6, // Semantic similarity weight
  KEYWORD_WEIGHT: 0.4, // Exact match weight

  // Reciprocal Rank Fusion parameters
  RRF_K: 60, // RRF constant (higher = more even distribution)

  // Result limits
  RERANK_TOP_K: 50, // Candidates to consider before reranking
  MAX_RESULTS: 20, // Final results to return

  // Score normalization
  NORMALIZE_SCORES: true, // Normalize scores to 0-1 before fusion

  // Minimum thresholds
  MIN_VECTOR_SCORE: 0.3, // Minimum cosine similarity
  MIN_KEYWORD_SCORE: 0.1, // Minimum BM25-like score
} as const;

// Chat commands
export const CHAT_COMMANDS = {
  SEARCH: 'search',
  RESTORE: 'restore',
  COMPARE: 'compare',
  EXPLAIN: 'explain',
  TIMELINE: 'timeline',
  SIMILAR: 'similar',
  PATTERNS: 'patterns',
} as const;

// Webview panel IDs
export const WEBVIEW_IDS = {
  TIMELINE: 'codeHistorian.timeline',
  SETTINGS: 'codeHistorian.settings',
  DIFF_VIEWER: 'codeHistorian.diffViewer',
} as const;

// Event names
export const EVENTS = {
  CHANGE_CAPTURED: 'change:captured',
  SESSION_STARTED: 'session:started',
  SESSION_ENDED: 'session:ended',
  SEARCH_COMPLETED: 'search:completed',
  RESTORE_COMPLETED: 'restore:completed',
  CONFIG_CHANGED: 'config:changed',
  ERROR_OCCURRED: 'error:occurred',
  EMBEDDING_COMPLETED: 'embedding:completed',
  INDEX_UPDATED: 'index:updated',
} as const;
