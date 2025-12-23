# Code Historian

<div align="center">

![Code Historian Logo](media/icon.png)

**AI-Powered Code History Tracking with RAG-Based Natural Language Search**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/KirtiNathJha.code-historian?label=VS%20Code%20Marketplace&logo=visualstudiocode&color=blue)](https://marketplace.visualstudio.com/items?itemName=KirtiNathJha.code-historian)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/KirtiNathJha.code-historian?logo=visualstudiocode&color=brightgreen)](https://marketplace.visualstudio.com/items?itemName=KirtiNathJha.code-historian)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/KirtiNathJha.code-historian?logo=visualstudiocode&color=orange)](https://marketplace.visualstudio.com/items?itemName=KirtiNathJha.code-historian)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

*Never lose track of your code changes again. Search, explore, and restore any version with natural language.*

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Configuration](#-configuration) • [Architecture](#-architecture)

</div>

---

## ✨ Features

### 🔄 **Automatic Change Capture**
- Real-time capture of all code changes as you work
- Intelligent debouncing to avoid capturing every keystroke
- Configurable exclusion patterns for `node_modules`, build files, etc.
- Tracks file creates, modifies, deletes, and renames
- Session-based organization for better context

### 🧠 **Semantic Search with RAG**
- Natural language queries: *"What changes did I make to the authentication logic?"*
- **Hybrid search** combining vector similarity and keyword matching (BM25)
- Context-aware results with relevant code snippets
- Temporal filtering: *"Changes from last week"*
- Powered by state-of-the-art embedding models

### 💬 **Chat Integration**
- Use `@historian` in VS Code Chat to explore your code history
- Conversational interface powered by your choice of LLM
- Ask questions like:
  - *"When did I last modify the User class?"*
  - *"Find all changes related to database queries"*
  - *"What did the login function look like before the refactor?"*

### ⏪ **Code Restoration**
- Restore any previous version of your code with one click
- Preview changes before restoring
- Automatic backup creation before restoration
- Works seamlessly with your existing git workflow

### 📊 **Visual Timeline**
- Beautiful, modern timeline view of all changes
- **Multiple view modes**: Timeline, Cards, or Compact list
- **Stats dashboard** with activity heatmap
- Group by date, file, or folder
- Inline diff preview with syntax highlighting
- Filter by change type, date range, and more

## 🚀 Installation

### VS Code Marketplace (Recommended)

1. Open VS Code
2. Go to Extensions (`Cmd/Ctrl + Shift + X`)
3. Search for **"Code Historian"**
4. Click **Install**

Or install directly: **[Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=KirtiNathJha.code-historian)**

### From Source

```bash
git clone https://github.com/KirtiJha/code-historian.git
cd code-historian
npm install
npm run build
```

Then press **F5** in VS Code to launch the extension in development mode.

---

## ⚙️ Configuration

Open VS Code Settings (`Cmd/Ctrl + ,`) and search for "Code Historian".

### Embedding Provider

Code Historian supports multiple embedding providers for semantic search:

| Provider | Model | Local | Cost | Dimensions |
|----------|-------|:-----:|------|:----------:|
| **HuggingFace** (default) | BAAI/bge-large-en-v1.5 | ❌ | Free | 1024 |
| **Ollama** | nomic-embed-text | ✅ | Free | 768 |
| **OpenAI** | text-embedding-3-small | ❌ | Paid | 1536 |

```json
{
  "codeHistorian.embedding.provider": "huggingface",
  "codeHistorian.embedding.model": "BAAI/bge-large-en-v1.5"
}
```

### LLM Provider

For the chat interface, configure your preferred LLM:

| Provider | Models | Local | Setup |
|----------|--------|:-----:|-------|
| **Ollama** | llama3.2, mistral, codellama | ✅ | Free, local |
| **OpenAI** | gpt-4o, gpt-4-turbo, gpt-3.5-turbo | ❌ | API key required |
| **Anthropic** | claude-sonnet-4-20250514, claude-3-haiku | ❌ | API key required |
| **Google Gemini** | gemini-pro, gemini-1.5-flash | ❌ | API key required |

```json
{
  "codeHistorian.llm.provider": "openai",
  "codeHistorian.llm.model": "gpt-4o",
  "codeHistorian.llm.apiKey": "your-api-key"
}
```

### Capture Settings

```json
{
  "codeHistorian.capture.enabled": true,
  "codeHistorian.capture.debounceMs": 2000,
  "codeHistorian.capture.excludePatterns": [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/*.lock"
  ],
  "codeHistorian.capture.maxFileSizeKB": 1024
}
```

---

## 📖 Usage

### Timeline View

1. Click the **Code Historian** icon in the Activity Bar (sidebar)
2. Browse your change history with multiple view options:
   - **Timeline View**: Classic vertical timeline with connecting lines
   - **Cards View**: Grid layout for visual scanning
   - **Compact View**: Dense list for maximum information
3. Use filters to narrow down results:
   - Filter by change type (Created, Modified, Deleted)
   - Filter by date range
   - Search by filename or content
4. Click any change to see detailed diff view
5. **Restore** any previous version with one click

### Chat Commands

Open VS Code Chat (`Cmd/Ctrl + Shift + I`) and use `@historian`:

```
@historian What changes did I make to the authentication module?
@historian Show me the login function from last week
@historian Find all database-related changes
@historian When did I add the validation logic?
```

### Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+H` / `Cmd+Shift+H` | Open Timeline |
| `Ctrl+Shift+F` / `Cmd+Shift+F` | Search History |

---

## 🏗️ Architecture

Code Historian uses a modern architecture optimized for VS Code extensions:

```
┌─────────────────────────────────────────────────────────────┐
│                     VS Code Extension                        │
├──────────────┬──────────────┬───────────────┬───────────────┤
│   Capture    │   Embedding  │    Search     │     LLM       │
│   Engine     │   Service    │    Engine     │  Orchestrator │
│              │              │               │               │
│  • Debounce  │  • HuggingFace│ • Hybrid     │  • OpenAI     │
│  • Diff Gen  │  • Ollama    │   Search     │  • Anthropic  │
│  • Sessions  │  • OpenAI    │ • BM25+Vector│  • Ollama     │
├──────────────┴──────────────┴───────────────┴───────────────┤
│                      Database Layer                          │
│     SQLite (sql.js)          │        LanceDB               │
│     • Metadata               │        • Vector embeddings   │
│     • FTS5 keyword search    │        • Similarity search   │
├──────────────────────────────┴──────────────────────────────┤
│                     React Webview UI                         │
│  Timeline • Search • Settings • Diff Viewer • Chat          │
└─────────────────────────────────────────────────────────────┘
```

### Key Technologies

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Metadata DB** | SQLite (sql.js) | Fast, in-browser metadata storage with FTS5 |
| **Vector DB** | LanceDB | Embedded vector database with ANN search |
| **Embeddings** | HuggingFace/Ollama | Semantic code understanding |
| **UI Framework** | React 18 | Modern, reactive webview interface |
| **Build Tool** | esbuild | Fast TypeScript bundling |
| **Chat API** | VS Code Chat | Native chat participant integration |

### Search Pipeline

```
User Query → Embedding → Vector Search (top-k)
                     ↘
                       RRF Fusion → Ranked Results
                     ↗
            → BM25 Keyword Search (FTS5)
```

The hybrid search combines:
- **Vector similarity** (60% weight): Semantic understanding of code
- **Keyword matching** (40% weight): Exact term matches via FTS5
- **Reciprocal Rank Fusion**: Combines both result sets with overlap boosting

---

## 📈 Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| Change capture | < 50ms | Debounced, non-blocking |
| Embedding generation | < 200ms | Batched for efficiency |
| Vector search | < 100ms | For 10K+ changes |
| Hybrid search | < 200ms | Vector + keyword fusion |
| UI render | < 16ms | 60fps smooth scrolling |

**Storage**: ~1MB per 1,000 changes (including embeddings)

---

## 🔒 Privacy

Your data stays **100% local** by default:

- ✅ SQLite database in VS Code's global storage
- ✅ LanceDB vectors stored locally
- ✅ Optional Ollama for completely local AI
- ✅ **No telemetry** or external data sharing
- ✅ API keys stored securely in VS Code settings

When using cloud providers (OpenAI, HuggingFace, Anthropic), only embedding requests and chat queries are sent externally.

---

## 🛠️ Development

```bash
# Clone the repository
git clone https://github.com/KirtiJha/code-historian.git
cd code-historian

# Install dependencies
npm install

# Build the extension
npm run build

# Watch mode (auto-rebuild on changes)
npm run watch

# Type checking
npm run typecheck

# Linting
npm run lint

# Run tests
npm test
```

### Project Structure

```
code-historian/
├── src/
│   ├── extension.ts        # Extension entry point
│   ├── constants.ts        # Configuration constants
│   ├── types/              # TypeScript type definitions
│   ├── database/           # SQLite & LanceDB wrappers
│   ├── services/           # Core services
│   │   ├── capture.ts      # Change capture engine
│   │   ├── embedding.ts    # Embedding service
│   │   ├── search.ts       # Hybrid search engine
│   │   ├── llm.ts          # LLM orchestrator
│   │   └── restoration.ts  # Code restoration
│   ├── chat/               # VS Code Chat participant
│   ├── webview/            # React webview UI
│   │   ├── ui/             # React components
│   │   └── provider.ts     # Webview provider
│   └── utils/              # Utilities
├── media/                  # Icons and assets
├── dist/                   # Build output
└── package.json            # Extension manifest
```

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and development process.

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [LanceDB](https://github.com/lancedb/lancedb) - Excellent embedded vector database
- [Ollama](https://ollama.ai) - Local AI inference made easy
- [HuggingFace](https://huggingface.co) - State-of-the-art embeddings
- [VS Code](https://code.visualstudio.com) - Amazing extension API
- [sql.js](https://github.com/sql-js/sql.js) - SQLite compiled to WebAssembly

---

<div align="center">

**Made with ❤️ for developers who value their code history**

[Report Bug](https://github.com/KirtiJha/code-historian/issues) • [Request Feature](https://github.com/KirtiJha/code-historian/issues)

</div>
