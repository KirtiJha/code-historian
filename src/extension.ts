/**
 * Code Historian Extension
 * Main entry point
 */

import * as vscode from 'vscode';
import { EXTENSION_ID, EVENTS } from './constants';
import { MetadataDatabase } from './database/metadata';
import { VectorStore } from './database/vectorStore';
import { CaptureEngine } from './services/capture';
import { EmbeddingService } from './services/embedding';
import { SearchEngine } from './services/search';
import { LLMOrchestrator } from './services/llm';
import { RestorationEngine } from './services/restoration';
import { ChatParticipant } from './chat/participant';
import { WebviewProvider } from './webview/provider';
import { logger, LogLevel } from './utils/logger';
import { generateWorkspaceId } from './utils';
import { eventEmitter } from './utils/events';
import type {
  WebviewToExtensionMessage,
  TimelineData,
  TimelineChange,
  SettingsData,
  StatusData,
} from './webview/types';
import type { Session, ChangeRecord, LLMConfig, EmbeddingConfig, CaptureConfig } from './types';

// Extension state
let metadataDb: MetadataDatabase;
let vectorStore: VectorStore;
let captureEngine: CaptureEngine;
let embeddingService: EmbeddingService;
let searchEngine: SearchEngine;
let llmOrchestrator: LLMOrchestrator;
let restorationEngine: RestorationEngine;
let _chatParticipant: ChatParticipant;
let webviewProvider: WebviewProvider;
let currentSession: Session | null = null;
let statusBarItem: vscode.StatusBarItem;
let workspaceId: string;

// Command IDs - must match package.json contributes.commands
const COMMANDS = {
  OPEN_TIMELINE: 'codeHistorian.openTimeline',
  SEARCH_HISTORY: 'codeHistorian.searchHistory',
  OPEN_SETTINGS: 'codeHistorian.openSettings',
  PAUSE_CAPTURE: 'codeHistorian.pauseCapture',
  RESUME_CAPTURE: 'codeHistorian.resumeCapture',
  CLEAR_HISTORY: 'codeHistorian.clearHistory',
  EXPORT_HISTORY: 'codeHistorian.exportHistory',
  SHOW_FILE_HISTORY: 'codeHistorian.showFileHistory',
} as const;

// Settings keys - must match keys registered in package.json
const SETTINGS = {
  CAPTURE_ENABLED: 'capture.enabled',
  DEBOUNCE_MS: 'capture.debounceMs',
  EXCLUDE_PATTERNS: 'capture.excludePatterns',
  MAX_FILE_SIZE: 'capture.maxFileSizeKB', // Note: capital KB in package.json
  EMBEDDING_PROVIDER: 'embedding.provider',
  EMBEDDING_MODEL: 'embedding.model',
  LLM_PROVIDER: 'llm.provider',
  LLM_MODEL: 'llm.model',
} as const;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Create output channel first so we can log
  const outputChannel = vscode.window.createOutputChannel('Code Historian');
  context.subscriptions.push(outputChannel);
  logger.initialize(outputChannel);

  // Enable debug logging to help diagnose issues
  logger.setLevel(LogLevel.DEBUG);

  logger.info('Activating Code Historian extension');

  try {
    // Initialize status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(history) Initializing...';
    statusBarItem.tooltip = 'Code Historian';
    statusBarItem.command = COMMANDS.OPEN_TIMELINE;
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Initialize services
    await initializeServices(context);

    // Register commands
    registerCommands(context);

    // Register webview
    registerWebview(context);

    // Register chat participant
    registerChatParticipant(context);

    // Start capture if enabled
    const config = vscode.workspace.getConfiguration(EXTENSION_ID);
    if (config.get(SETTINGS.CAPTURE_ENABLED, true)) {
      await startCapture();
    }

    // Process any pending changes without embeddings (background task)
    // Only try this if we have a configured cloud provider (HuggingFace/OpenAI) with an API key
    // or if Ollama is confirmed running
    const embeddingConfig = getEmbeddingConfig();
    const hasCloudApiKey = embeddingConfig.apiKey && embeddingConfig.apiKey.length > 0;
    const isCloudProvider = ['huggingface', 'openai'].includes(embeddingConfig.provider);

    if (embeddingService.isConfigured() && (hasCloudApiKey || !isCloudProvider)) {
      // Only try to process if we have a valid config
      // For cloud providers, we need an API key
      // For Ollama, we'll try but catch errors gracefully
      embeddingService
        .processPendingChanges(workspaceId)
        .then(count => {
          if (count > 0) {
            logger.info(`Processed ${count} pending changes for embeddings`);
          }
        })
        .catch(err => {
          // This is expected if Ollama isn't running or other provider issues
          logger.debug('Background embedding processing skipped:', err.message || err);
        });
    } else {
      logger.info('Embedding service not fully configured - skipping background embedding');
      logger.info('Configure embedding provider and API key in Settings to enable semantic search');
    }

    // Update status bar
    statusBarItem.text = '$(history) Code Historian';
    statusBarItem.tooltip = 'Code Historian - Click to show timeline';

    logger.info('Code Historian extension activated successfully');
    vscode.window.showInformationMessage('Code Historian is now active');
  } catch (error) {
    logger.error('Failed to activate extension', error as Error);
    statusBarItem.text = '$(error) Code Historian';
    statusBarItem.tooltip = 'Code Historian - Initialization failed';
    vscode.window.showErrorMessage(`Failed to activate Code Historian: ${error}`);
  }
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
  logger.info('Deactivating Code Historian extension');

  try {
    // Stop capture
    if (captureEngine) {
      await captureEngine.stop();
    }

    // End current session
    if (currentSession && metadataDb) {
      metadataDb.endSession(currentSession.id);
    }

    // Close databases
    if (metadataDb) {
      metadataDb.close();
    }

    logger.info('Code Historian extension deactivated');
  } catch (error) {
    logger.error('Error during deactivation', error as Error);
  }
}

/**
 * Initialize all services
 */
async function initializeServices(context: vscode.ExtensionContext): Promise<void> {
  const storagePath = context.globalStorageUri.fsPath;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  workspaceId = generateWorkspaceId(workspaceRoot);

  // Initialize databases
  metadataDb = new MetadataDatabase(storagePath);
  await metadataDb.initialize();

  // Get embedding config first to determine vector dimensions
  const embeddingConfig = getEmbeddingConfig();

  // Initialize vector store with correct dimensions for the embedding model
  vectorStore = new VectorStore(storagePath, embeddingConfig.dimensions);
  await vectorStore.initialize();

  // Initialize embedding service
  embeddingService = new EmbeddingService(embeddingConfig, vectorStore, metadataDb);
  await embeddingService.initialize();

  // Initialize search engine
  // Note: Cross-encoder reranking is disabled because HuggingFace's free inference API
  // doesn't support cross-encoder models (bge-reranker, ms-marco, etc.)
  // The hybrid search with RRF (Reciprocal Rank Fusion) provides good results without reranking
  searchEngine = new SearchEngine(vectorStore, metadataDb, embeddingService, workspaceId);

  // Reranker disabled - would require a dedicated inference endpoint or local model
  // To enable in future: use Cohere Rerank API or deploy a dedicated HuggingFace endpoint
  // searchEngine.setRerankerEnabled(true, apiKey);
  // searchEngine.updateRerankerConfig({ provider: 'cohere', model: 'rerank-english-v3.0' });

  // Initialize LLM orchestrator
  const llmConfig = getLLMConfig();
  llmOrchestrator = new LLMOrchestrator(llmConfig);

  // Initialize restoration engine
  restorationEngine = new RestorationEngine(workspaceRoot, metadataDb, storagePath);

  // Initialize capture engine
  const captureConfig = getCaptureConfig();
  captureEngine = new CaptureEngine(context, workspaceRoot, metadataDb, captureConfig);

  // Connect capture engine to embedding service via events
  // When a change is captured, process it to generate embeddings
  context.subscriptions.push(
    eventEmitter.on(EVENTS.CHANGE_CAPTURED, async change => {
      try {
        // Only process if embedding service is configured
        if (embeddingService.isConfigured()) {
          await embeddingService.processChange(change);
          logger.debug(`Generated embedding for change: ${change.id}`);
        }
      } catch (error) {
        logger.warn(`Failed to generate embedding for change ${change.id}:`, error as Error);
        // Don't throw - embedding failure shouldn't block capture
      }
    })
  );

  // Create initial session
  currentSession = metadataDb.createSession(workspaceId);
  logger.info(`Created session: ${currentSession.id}`);
}

/**
 * Register all commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
  // Open timeline command
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_TIMELINE, async () => {
      await vscode.commands.executeCommand('workbench.view.extension.codeHistorian');
    })
  );

  // Search history command
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SEARCH_HISTORY, async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search your code history',
        placeHolder: 'Enter search query...',
      });

      if (query) {
        const results = await searchEngine.search({
          naturalLanguage: query,
          hybridParams: { vectorWeight: 0.7, keywordWeight: 0.3, rerankTopK: 20 },
        });

        // Show results in webview
        webviewProvider.postMessage({
          type: 'searchResults',
          data: {
            results: results.map(r => ({
              change: convertToTimelineChange(r.change),
              score: r.score,
              highlights: [],
            })),
            total: results.length,
            query,
            executionTime: 0,
          },
        });
      }
    })
  );

  // Show file history command
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.SHOW_FILE_HISTORY, async (uri?: vscode.Uri) => {
      const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!fileUri) {
        vscode.window.showWarningMessage('No file selected');
        return;
      }

      const changes = metadataDb.getChanges(
        workspaceId,
        {
          filePatterns: [fileUri.fsPath],
        },
        100
      );

      if (changes.length === 0) {
        vscode.window.showInformationMessage('No history found for this file');
        return;
      }

      // Show results in webview
      webviewProvider.postMessage({
        type: 'searchResults',
        data: {
          results: changes.map((c: ChangeRecord) => ({
            change: convertToTimelineChange(c),
            score: 1.0,
            highlights: [],
          })),
          total: changes.length,
          query: `File: ${fileUri.fsPath}`,
          executionTime: 0,
        },
      });
    })
  );

  // Resume capture command
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.RESUME_CAPTURE, async () => {
      await startCapture();
      vscode.window.showInformationMessage('Code capture resumed');
    })
  );

  // Pause capture command
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.PAUSE_CAPTURE, async () => {
      await captureEngine.stop();
      updateStatusBar(false);
      vscode.window.showInformationMessage('Code capture paused');
    })
  );

  // Export history command
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPORT_HISTORY, async () => {
      const format = await vscode.window.showQuickPick(['JSON', 'Markdown', 'HTML'], {
        placeHolder: 'Select export format',
      });

      if (format) {
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`code-history.${format.toLowerCase()}`),
          filters: {
            [format]: [format.toLowerCase()],
          },
        });

        if (uri) {
          try {
            const changes = metadataDb.getChanges(workspaceId);
            const content = exportHistory(
              changes,
              format.toLowerCase() as 'json' | 'markdown' | 'html'
            );
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
            vscode.window.showInformationMessage(`History exported to ${uri.fsPath}`);
          } catch (error) {
            vscode.window.showErrorMessage(`Export failed: ${error}`);
          }
        }
      }
    })
  );

  // Clear history command
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.CLEAR_HISTORY, async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Are you sure you want to clear all history? This cannot be undone.',
        { modal: true },
        'Yes, Clear All'
      );

      if (confirm === 'Yes, Clear All') {
        try {
          metadataDb.deleteOldChanges(workspaceId, 0); // Delete all by passing 0 days
          await vectorStore.clear();
          vscode.window.showInformationMessage('History cleared successfully');
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to clear history: ${error}`);
        }
      }
    })
  );

  // Open settings command
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.OPEN_SETTINGS, () => {
      vscode.commands.executeCommand('workbench.action.openSettings', EXTENSION_ID);
    })
  );
}

/**
 * Register webview provider
 */
function registerWebview(context: vscode.ExtensionContext): void {
  webviewProvider = new WebviewProvider(context.extensionUri, handleWebviewMessage);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, webviewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
}

/**
 * Register chat participant
 */
function registerChatParticipant(context: vscode.ExtensionContext): void {
  _chatParticipant = new ChatParticipant(context, searchEngine, llmOrchestrator, restorationEngine);
}

/**
 * Handle messages from webview
 */
async function handleWebviewMessage(message: WebviewToExtensionMessage): Promise<void> {
  try {
    switch (message.type) {
      case 'ready':
        await sendStatus();
        break;

      case 'getTimeline': {
        const data = message.data;
        const filters = {
          timeRange:
            data.dateFrom || data.dateTo
              ? {
                  start: data.dateFrom || 0,
                  end: data.dateTo || Date.now(),
                }
              : undefined,
          filePatterns: data.filePath ? [data.filePath] : undefined,
        };

        const changes = metadataDb.getChanges(
          workspaceId,
          filters,
          data.pageSize || 50,
          ((data.page || 1) - 1) * (data.pageSize || 50)
        );

        const timelineData: TimelineData = {
          changes: changes.map(convertToTimelineChange),
          total: changes.length,
          page: data.page || 1,
          pageSize: data.pageSize || 50,
          hasMore: changes.length === (data.pageSize || 50),
          groupedByDate: groupChangesByDate(changes.map(convertToTimelineChange)),
        };

        await webviewProvider.postMessage({ type: 'timeline', data: timelineData });
        break;
      }

      case 'getChangeDetails': {
        const change = metadataDb.getChange(message.data.changeId);
        if (change) {
          // Try to get actual file size from disk
          let fileSize = 0;
          try {
            const fs = await import('fs');
            const stats = fs.statSync(change.absolutePath);
            fileSize = stats.size;
          } catch {
            // File might not exist anymore, use estimate from totalLines
            fileSize = change.totalLines * 40; // ~40 bytes per line estimate
          }

          await webviewProvider.postMessage({
            type: 'changeDetails',
            data: {
              change: convertToTimelineChange(change),
              diff: {
                oldContent: change.contentBefore || '',
                newContent: change.contentAfter || '',
                rawDiff: change.diff || '', // Send the unified diff string
                hunks: [],
                stats: {
                  additions: change.linesAdded || 0,
                  deletions: change.linesDeleted || 0,
                  changes: (change.linesAdded || 0) + (change.linesDeleted || 0),
                },
              },
              context: {
                relatedChanges: [],
              },
              metadata: {
                fileSize,
                totalLines: change.totalLines || 0,
                encoding: 'utf-8',
                eol: '\n',
                absolutePath: change.absolutePath,
                gitAuthor: change.gitAuthor,
                activeFunction: change.activeFunction,
                activeClass: change.activeClass,
              },
            },
          });
        }
        break;
      }

      case 'search': {
        const results = await searchEngine.search({
          naturalLanguage: message.data.query,
          hybridParams: {
            vectorWeight: 0.7,
            keywordWeight: 0.3,
            rerankTopK: message.data.limit || 20,
          },
        });

        await webviewProvider.postMessage({
          type: 'searchResults',
          data: {
            results: results.map(r => ({
              change: convertToTimelineChange(r.change),
              score: r.score,
              highlights: [],
            })),
            total: results.length,
            query: message.data.query,
            executionTime: 0,
          },
        });
        break;
      }

      case 'restore': {
        // Note: targetPath can be relative - the RestorationEngine will resolve it
        // If targetPath is provided but relative, resolve it to absolute
        let targetPath = message.data.targetPath;
        if (targetPath && !targetPath.startsWith('/')) {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (workspaceFolder) {
            targetPath = vscode.Uri.joinPath(workspaceFolder.uri, targetPath).fsPath;
          }
        }
        
        try {
          const result = await restorationEngine.restore({
            changeId: message.data.changeId,
            targetPath: targetPath,
            dryRun: false,
          });

          if (result.success) {
            await webviewProvider.sendToast('success', `Restored ${result.linesRestored} line(s)`);
          } else {
            await webviewProvider.sendToast('error', `Restoration failed: ${result.error}`);
          }
        } catch (error) {
          logger.error(`Restoration failed`, error as Error);
          await webviewProvider.sendToast('error', `Restoration failed: ${(error as Error).message}`);
        }
        break;
      }

      case 'getSettings': {
        await webviewProvider.postMessage({ type: 'settings', data: getCurrentSettings() });
        break;
      }

      case 'updateSettings': {
        logger.info('Received updateSettings from webview:', JSON.stringify(message.data, null, 2));
        logger.show(); // Show the output channel for debugging
        await updateSettings(message.data);
        // Send back the confirmed settings from VS Code configuration
        const confirmedSettings = getCurrentSettings();
        logger.info('Sending back confirmed settings:', JSON.stringify(confirmedSettings, null, 2));
        await webviewProvider.postMessage({ type: 'settings', data: confirmedSettings });
        await webviewProvider.sendToast('success', 'Settings saved');
        break;
      }

      case 'openFile': {
        // Handle both relative and absolute paths
        let filePath = message.data.filePath;
        if (!filePath.startsWith('/')) {
          // Relative path - resolve against workspace root
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (workspaceFolder) {
            filePath = vscode.Uri.joinPath(workspaceFolder.uri, filePath).fsPath;
          }
        }
        
        try {
          const uri = vscode.Uri.file(filePath);
          const doc = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(doc);
          if (message.data.line) {
            const position = new vscode.Position(message.data.line - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
          }
        } catch (error) {
          logger.error(`Failed to open file: ${filePath}`, error as Error);
          await webviewProvider.sendToast('error', `Failed to open file: ${(error as Error).message}`);
        }
        break;
      }

      case 'refresh':
        await sendStatus();
        break;

      case 'chat': {
        // Handle AI chat from the webview with LLM-powered responses
        const chatMessage = message.data.message;
        try {
          // First, search for relevant changes
          const searchResults = await searchEngine.search({
            naturalLanguage: chatMessage,
          });

          // Extract the change records for LLM context
          const contextChanges = searchResults.slice(0, 5).map(r => r.change);

          // Check if LLM is available
          if (!llmOrchestrator.isAvailable()) {
            // Fallback to just showing search results
            if (searchResults.length > 0) {
              await webviewProvider.postMessage({
                type: 'chatResponse',
                data: {
                  query: chatMessage,
                  response:
                    `I found ${searchResults.length} relevant changes but AI responses require an LLM to be configured. Here's what I found:\n\n` +
                    searchResults
                      .slice(0, 5)
                      .map(
                        (r, i) =>
                          `${i + 1}. **${r.change.filePath}** - ${r.change.eventType} (${new Date(r.change.timestamp).toLocaleString()})\n   +${r.change.linesAdded}/-${r.change.linesDeleted} lines`
                      )
                      .join('\n\n') +
                    '\n\nConfigure an LLM in Settings for AI-powered answers.',
                  sources: searchResults.slice(0, 5).map(r => ({
                    changeId: r.change.id,
                    filePath: r.change.filePath,
                    timestamp: r.change.timestamp,
                    score: r.score,
                  })),
                },
              });
            } else {
              await webviewProvider.postMessage({
                type: 'chatResponse',
                data: {
                  query: chatMessage,
                  response:
                    'No relevant changes found in your code history. Try a different query or make some code changes first.',
                  sources: [],
                },
              });
            }
            return;
          }

          // Send initial response to show we're working
          await webviewProvider.postMessage({
            type: 'chatResponse',
            data: {
              query: chatMessage,
              response: '',
              sources: searchResults.slice(0, 5).map(r => ({
                changeId: r.change.id,
                filePath: r.change.filePath,
                timestamp: r.change.timestamp,
                score: r.score,
              })),
              isStreaming: true,
            },
          });

          // Use LLM with streaming to generate response
          const messages = [{ role: 'user' as const, content: chatMessage }];

          let fullResponse = '';
          for await (const chunk of llmOrchestrator.streamChat(messages, contextChanges)) {
            fullResponse += chunk;
            await webviewProvider.postMessage({
              type: 'chatResponseChunk',
              data: { chunk },
            });
          }

          // Send end signal
          await webviewProvider.postMessage({
            type: 'chatResponseEnd',
            data: { query: chatMessage },
          });
        } catch (error) {
          logger.error('Chat query failed', error as Error);
          await webviewProvider.postMessage({
            type: 'chatResponse',
            data: {
              query: chatMessage,
              response: `Sorry, I encountered an error: ${(error as Error).message}. Please check your LLM settings.`,
              sources: [],
            },
          });
        }
        break;
      }

      case 'exportHistory': {
        await vscode.commands.executeCommand(COMMANDS.EXPORT_HISTORY);
        break;
      }

      case 'clearHistory': {
        await vscode.commands.executeCommand(COMMANDS.CLEAR_HISTORY);
        break;
      }

      case 'testConnection': {
        const { provider } = message.data;
        try {
          if (provider === 'embedding') {
            // Test embedding connection
            const config = vscode.workspace.getConfiguration('codeHistorian');
            const embeddingProvider = config.get<string>('embedding.provider', 'ollama');

            if (embeddingProvider === 'ollama') {
              // Test Ollama connection
              const baseUrl = config.get<string>(
                'embedding.ollamaBaseUrl',
                'http://localhost:11434'
              );
              const response = await fetch(`${baseUrl}/api/version`);
              if (!response.ok) {
                throw new Error(`Ollama not reachable at ${baseUrl}`);
              }
              await webviewProvider.postMessage({
                type: 'testConnectionResult',
                data: {
                  success: true,
                  provider: 'embedding',
                  message: `Connected to Ollama at ${baseUrl}`,
                },
              });
            } else if (embeddingProvider === 'huggingface') {
              // Test HuggingFace API
              const apiKey = config.get<string>('embedding.huggingfaceApiKey', '');
              if (!apiKey) {
                throw new Error('HuggingFace API key not configured');
              }
              const model = config.get<string>('embedding.model', 'BAAI/bge-large-en-v1.5');
              const response = await fetch(
                `https://api-inference.huggingface.co/pipeline/feature-extraction/${model}`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ inputs: 'test' }),
                }
              );
              if (!response.ok) {
                const text = await response.text();
                throw new Error(`HuggingFace API error: ${text}`);
              }
              await webviewProvider.postMessage({
                type: 'testConnectionResult',
                data: {
                  success: true,
                  provider: 'embedding',
                  message: `Connected to HuggingFace (${model})`,
                },
              });
            } else if (embeddingProvider === 'openai') {
              // Test OpenAI API
              const apiKey = config.get<string>('embedding.openaiApiKey', '');
              if (!apiKey) {
                throw new Error('OpenAI API key not configured');
              }
              const response = await fetch('https://api.openai.com/v1/models', {
                headers: { Authorization: `Bearer ${apiKey}` },
              });
              if (!response.ok) {
                throw new Error('OpenAI API key is invalid');
              }
              await webviewProvider.postMessage({
                type: 'testConnectionResult',
                data: {
                  success: true,
                  provider: 'embedding',
                  message: 'Connected to OpenAI Embeddings API',
                },
              });
            }
          } else if (provider === 'llm') {
            // Test LLM connection
            const config = vscode.workspace.getConfiguration('codeHistorian');
            const llmProvider = config.get<string>('llm.provider', 'ollama');

            if (llmProvider === 'ollama') {
              const baseUrl = config.get<string>('llm.ollamaBaseUrl', 'http://localhost:11434');
              const response = await fetch(`${baseUrl}/api/version`);
              if (!response.ok) {
                throw new Error(`Ollama not reachable at ${baseUrl}`);
              }
              await webviewProvider.postMessage({
                type: 'testConnectionResult',
                data: {
                  success: true,
                  provider: 'llm',
                  message: `Connected to Ollama at ${baseUrl}`,
                },
              });
            } else if (llmProvider === 'openai') {
              const apiKey = config.get<string>('llm.openaiApiKey', '');
              if (!apiKey) {
                throw new Error('OpenAI API key not configured');
              }
              const response = await fetch('https://api.openai.com/v1/models', {
                headers: { Authorization: `Bearer ${apiKey}` },
              });
              if (!response.ok) {
                throw new Error('OpenAI API key is invalid');
              }
              await webviewProvider.postMessage({
                type: 'testConnectionResult',
                data: { success: true, provider: 'llm', message: 'Connected to OpenAI API' },
              });
            } else if (llmProvider === 'anthropic') {
              const apiKey = config.get<string>('llm.anthropicApiKey', '');
              if (!apiKey) {
                throw new Error('Anthropic API key not configured');
              }
              // Anthropic doesn't have a simple test endpoint, so we just validate the key format
              if (!apiKey.startsWith('sk-ant-')) {
                throw new Error('Anthropic API key format is invalid (should start with sk-ant-)');
              }
              await webviewProvider.postMessage({
                type: 'testConnectionResult',
                data: { success: true, provider: 'llm', message: 'Anthropic API key configured' },
              });
            } else if (llmProvider === 'google') {
              const apiKey = config.get<string>('llm.googleApiKey', '');
              if (!apiKey) {
                throw new Error('Google API key not configured');
              }
              await webviewProvider.postMessage({
                type: 'testConnectionResult',
                data: { success: true, provider: 'llm', message: 'Google API key configured' },
              });
            }
          }
        } catch (error) {
          await webviewProvider.postMessage({
            type: 'testConnectionResult',
            data: { success: false, provider, message: String(error) },
          });
        }
        break;
      }
    }
  } catch (error) {
    logger.error('Error handling webview message', error as Error);
    await webviewProvider.sendError('An error occurred', String(error));
  }
}

/**
 * Start capture engine
 */
async function startCapture(): Promise<void> {
  if (!currentSession) {
    currentSession = metadataDb.createSession(workspaceId);
  }

  await captureEngine.start();
  updateStatusBar(true);
}

/**
 * Update status bar
 */
function updateStatusBar(capturing: boolean): void {
  if (capturing) {
    statusBarItem.text = '$(record) Code Historian';
    statusBarItem.tooltip = 'Code Historian - Capturing changes';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.text = '$(history) Code Historian';
    statusBarItem.tooltip = 'Code Historian - Click to show timeline';
    statusBarItem.backgroundColor = undefined;
  }
}

/**
 * Send status to webview
 */
async function sendStatus(): Promise<void> {
  const stats = metadataDb.getStats(workspaceId);

  const status: StatusData = {
    indexing: {
      active: false,
      progress: 100,
      totalFiles: stats.totalFiles,
      processedFiles: stats.totalFiles,
    },
    stats: {
      totalChanges: stats.totalChanges,
      totalFiles: stats.totalFiles,
      totalSessions: stats.totalSessions,
      storageUsedMb: 0,
      lastCaptureTime: stats.newestChange,
    },
    health: {
      database: 'ok',
      vectorStore: vectorStore ? 'ok' : 'initializing',
      embedding: 'ok',
      llm: llmOrchestrator ? 'ok' : 'not-configured',
    },
  };

  await webviewProvider.postMessage({ type: 'status', data: status });
}

/**
 * Get current settings
 */
function getCurrentSettings(): SettingsData {
  const config = vscode.workspace.getConfiguration(EXTENSION_ID);

  return {
    capture: {
      enabled: config.get(SETTINGS.CAPTURE_ENABLED, true),
      autoCapture: config.get(SETTINGS.CAPTURE_ENABLED, true), // Same as enabled - no separate setting in package.json
      debounceMs: config.get(SETTINGS.DEBOUNCE_MS, 1000),
      excludePatterns: config.get(SETTINGS.EXCLUDE_PATTERNS, ['**/node_modules/**', '**/.git/**']),
      maxFileSizeKb: config.get(SETTINGS.MAX_FILE_SIZE, 500),
    },
    embedding: {
      provider: config.get(SETTINGS.EMBEDDING_PROVIDER, 'ollama') as
        | 'ollama'
        | 'huggingface'
        | 'openai',
      model: config.get(SETTINGS.EMBEDDING_MODEL, 'nomic-embed-text'),
      batchSize: 32,
      ollamaUrl: config.get('embedding.ollamaEndpoint', 'http://localhost:11434'),
      openaiApiKey: config.get('embedding.openaiApiKey'),
      huggingfaceApiKey: config.get('embedding.huggingfaceApiKey'),
    },
    llm: {
      provider: config.get(SETTINGS.LLM_PROVIDER, 'ollama') as
        | 'openai'
        | 'anthropic'
        | 'ollama'
        | 'google',
      model: config.get(SETTINGS.LLM_MODEL, 'llama3.1'),
      temperature: config.get('llm.temperature', 0.3),
      maxTokens: config.get('llm.maxTokens', 4096),
      streaming: config.get('llm.streaming', true),
      ollamaUrl: config.get('llm.ollamaEndpoint', 'http://localhost:11434'),
      openaiApiKey: config.get('llm.openaiApiKey'),
      anthropicApiKey: config.get('llm.anthropicApiKey'),
      googleApiKey: config.get('llm.googleApiKey'),
    },
    storage: {
      maxChanges: config.get('storage.maxChanges', 10000),
      retentionDays: config.get('storage.retentionDays', 30),
      compressionEnabled: config.get('storage.compressionEnabled', true),
    },
    ui: {
      theme: config.get('ui.theme', 'auto') as 'light' | 'dark' | 'auto',
      compactMode: config.get('ui.compactMode', false),
      showLineNumbers: config.get('ui.showLineNumbers', true),
      diffStyle: config.get('ui.diffStyle', 'split') as 'split' | 'unified' | 'inline',
    },
  };
}

/**
 * Update settings
 */
async function updateSettings(settings: Partial<SettingsData>): Promise<void> {
  const config = vscode.workspace.getConfiguration(EXTENSION_ID);

  logger.info('updateSettings called with:', JSON.stringify(settings, null, 2));

  // Capture settings
  if (settings.capture) {
    if (settings.capture.enabled !== undefined) {
      await config.update(
        'capture.enabled',
        settings.capture.enabled,
        vscode.ConfigurationTarget.Global
      );
    }
    // autoCapture maps to enabled - skip separate save
    if (settings.capture.debounceMs !== undefined) {
      await config.update(
        SETTINGS.DEBOUNCE_MS,
        settings.capture.debounceMs,
        vscode.ConfigurationTarget.Global
      );
    }
    if (settings.capture.excludePatterns !== undefined) {
      await config.update(
        SETTINGS.EXCLUDE_PATTERNS,
        settings.capture.excludePatterns,
        vscode.ConfigurationTarget.Global
      );
    }
    if (settings.capture.maxFileSizeKb !== undefined) {
      await config.update(
        SETTINGS.MAX_FILE_SIZE,
        settings.capture.maxFileSizeKb,
        vscode.ConfigurationTarget.Global
      );
    }
  }

  // Embedding settings
  if (settings.embedding) {
    // First save all settings to config
    if (settings.embedding.provider !== undefined) {
      await config.update(
        SETTINGS.EMBEDDING_PROVIDER,
        settings.embedding.provider,
        vscode.ConfigurationTarget.Global
      );
    }
    if (settings.embedding.model !== undefined) {
      await config.update(
        SETTINGS.EMBEDDING_MODEL,
        settings.embedding.model,
        vscode.ConfigurationTarget.Global
      );
    }
    if (settings.embedding.ollamaUrl !== undefined) {
      await config.update(
        'embedding.ollamaEndpoint',
        settings.embedding.ollamaUrl,
        vscode.ConfigurationTarget.Global
      );
    }
    if (settings.embedding.openaiApiKey !== undefined) {
      await config.update(
        'embedding.openaiApiKey',
        settings.embedding.openaiApiKey,
        vscode.ConfigurationTarget.Global
      );
    }
    if ((settings.embedding as Record<string, unknown>).huggingfaceApiKey !== undefined) {
      await config.update(
        'embedding.huggingfaceApiKey',
        (settings.embedding as Record<string, unknown>).huggingfaceApiKey,
        vscode.ConfigurationTarget.Global
      );
    }

    // Now update embedding service with full config including API key
    const embeddingConfig = getEmbeddingConfig();
    embeddingService.updateConfig(embeddingConfig);
  }

  // LLM settings
  if (settings.llm) {
    // First save all settings to config
    if (settings.llm.provider !== undefined) {
      await config.update(
        SETTINGS.LLM_PROVIDER,
        settings.llm.provider,
        vscode.ConfigurationTarget.Global
      );
    }
    if (settings.llm.model !== undefined) {
      await config.update(
        SETTINGS.LLM_MODEL,
        settings.llm.model,
        vscode.ConfigurationTarget.Global
      );
    }
    if (settings.llm.temperature !== undefined) {
      await config.update(
        'llm.temperature',
        settings.llm.temperature,
        vscode.ConfigurationTarget.Global
      );
    }
    if (settings.llm.maxTokens !== undefined) {
      await config.update(
        'llm.maxTokens',
        settings.llm.maxTokens,
        vscode.ConfigurationTarget.Global
      );
    }
    if (settings.llm.ollamaUrl !== undefined) {
      await config.update(
        'llm.ollamaEndpoint',
        settings.llm.ollamaUrl,
        vscode.ConfigurationTarget.Global
      );
    }
    if (settings.llm.openaiApiKey !== undefined) {
      await config.update(
        'llm.openaiApiKey',
        settings.llm.openaiApiKey,
        vscode.ConfigurationTarget.Global
      );
    }
    if (settings.llm.anthropicApiKey !== undefined) {
      await config.update(
        'llm.anthropicApiKey',
        settings.llm.anthropicApiKey,
        vscode.ConfigurationTarget.Global
      );
    }
    if ((settings.llm as Record<string, unknown>).googleApiKey !== undefined) {
      await config.update(
        'llm.googleApiKey',
        (settings.llm as Record<string, unknown>).googleApiKey,
        vscode.ConfigurationTarget.Global
      );
    }

    // Now update LLM orchestrator with full config including API key
    // This ensures the provider is re-initialized with the correct API key
    // We need to wait for the configuration update to propagate
    // Using a small delay to ensure VS Code has updated the configuration
    await new Promise(resolve => setTimeout(resolve, 100));
    const llmConfig = getLLMConfig();
    logger.info('LLM config after save:', JSON.stringify(llmConfig));
    llmOrchestrator.updateConfig(llmConfig);
  }

  // Storage settings - only save what's registered in package.json
  // Registered: storage.path, storage.maxSizeMB
  // Note: maxChanges, retentionDays, compressionEnabled are NOT registered
  // Skip saving unregistered storage settings

  // UI settings - only save what's registered in package.json
  // Registered: ui.theme, ui.compactMode, ui.showInlineHistory
  // Note: showLineNumbers, diffStyle are NOT registered
  if (settings.ui) {
    if (settings.ui.theme !== undefined) {
      await config.update('ui.theme', settings.ui.theme, vscode.ConfigurationTarget.Global);
    }
    if (settings.ui.compactMode !== undefined) {
      await config.update(
        'ui.compactMode',
        settings.ui.compactMode,
        vscode.ConfigurationTarget.Global
      );
    }
    // Skip showLineNumbers and diffStyle - not registered in package.json
  }

  // Wait for VS Code configuration to fully propagate
  await new Promise(resolve => setTimeout(resolve, 200));

  // Log the final settings after all updates
  const finalSettings = getCurrentSettings();
  logger.info(
    'Settings saved successfully. Final settings:',
    JSON.stringify(finalSettings, null, 2)
  );
}

/**
 * Get embedding configuration from VS Code settings
 */
function getEmbeddingConfig(): EmbeddingConfig {
  const config = vscode.workspace.getConfiguration(EXTENSION_ID);
  const provider = config.get(SETTINGS.EMBEDDING_PROVIDER, 'ollama') as
    | 'ollama'
    | 'openai'
    | 'huggingface';

  // Get the appropriate API key based on provider (only needed for cloud providers)
  let apiKey: string | undefined;
  if (provider === 'huggingface') {
    apiKey = config.get('embedding.huggingfaceApiKey');
  } else if (provider === 'openai') {
    apiKey = config.get('embedding.openaiApiKey');
  }
  // Ollama doesn't need an API key

  const model = config.get(SETTINGS.EMBEDDING_MODEL, 'nomic-embed-text') as string;

  // Get dimensions from EMBEDDING_MODELS constant based on provider/model
  // Import from constants if needed, or use lookup
  const { EMBEDDING_MODELS } = require('./constants');
  const modelConfig = EMBEDDING_MODELS[provider]?.[model];
  const dimensions = modelConfig?.dimensions || config.get('embedding.dimensions', 768);

  return {
    provider,
    model,
    dimensions,
    endpoint: config.get('embedding.ollamaEndpoint', 'http://localhost:11434'),
    apiKey,
    batchSize: config.get('embedding.batchSize', 32),
    maxTokens: config.get('embedding.maxTokens', 8192),
  };
}

/**
 * Get LLM configuration from VS Code settings
 */
function getLLMConfig(): LLMConfig {
  const config = vscode.workspace.getConfiguration(EXTENSION_ID);
  const provider = config.get(SETTINGS.LLM_PROVIDER, 'ollama') as
    | 'openai'
    | 'anthropic'
    | 'ollama'
    | 'google';

  // Get the appropriate API key based on provider
  let apiKey: string | undefined;
  if (provider === 'openai') {
    apiKey = config.get('llm.openaiApiKey');
  } else if (provider === 'anthropic') {
    apiKey = config.get('llm.anthropicApiKey');
  } else if (provider === 'google') {
    apiKey = config.get('llm.googleApiKey');
  }
  // Ollama doesn't need an API key

  return {
    provider,
    model: config.get(SETTINGS.LLM_MODEL, 'llama3.1'),
    apiKey,
    endpoint: config.get('llm.ollamaEndpoint', 'http://localhost:11434'),
    temperature: config.get('llm.temperature', 0.3),
    maxTokens: config.get('llm.maxTokens', 4096),
    streaming: config.get('llm.streaming', true),
  };
}

/**
 * Get capture configuration from VS Code settings
 */
function getCaptureConfig(): CaptureConfig {
  const config = vscode.workspace.getConfiguration(EXTENSION_ID);

  return {
    enabled: config.get('capture.enabled', true),
    debounceMs: config.get(SETTINGS.DEBOUNCE_MS, 2000),
    maxHistoryDays: config.get('capture.maxHistoryDays', 90),
    excludePatterns: config.get(SETTINGS.EXCLUDE_PATTERNS, ['**/node_modules/**', '**/.git/**']),
    includePatterns: config.get('capture.includePatterns', []),
    maxFileSizeKB: config.get(SETTINGS.MAX_FILE_SIZE, 1024),
  };
}

/**
 * Convert database ChangeRecord to TimelineChange for webview
 */
function convertToTimelineChange(record: ChangeRecord): TimelineChange {
  return {
    id: record.id,
    timestamp: record.timestamp,
    filePath: record.filePath,
    fileName: record.filePath.split('/').pop() || record.filePath,
    language: record.language,
    changeType: record.eventType,
    linesAdded: record.linesAdded,
    linesRemoved: record.linesDeleted,
    summary: record.summary,
    symbols: record.symbols,
    branch: record.gitBranch,
    commitHash: record.gitCommit,
    sessionId: record.sessionId,
    tags: [],
  };
}

/**
 * Group changes by date for timeline display
 */
function groupChangesByDate(changes: TimelineChange[]): Record<string, TimelineChange[]> {
  const groups: Record<string, TimelineChange[]> = {};

  for (const change of changes) {
    const date = new Date(change.timestamp).toISOString().split('T')[0];
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(change);
  }

  return groups;
}

/**
 * Export history to various formats
 */
function exportHistory(changes: ChangeRecord[], format: 'json' | 'markdown' | 'html'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(changes, null, 2);

    case 'markdown': {
      let md = '# Code History Export\n\n';
      md += `Generated: ${new Date().toISOString()}\n\n`;
      md += `Total Changes: ${changes.length}\n\n`;
      md += '---\n\n';

      for (const change of changes) {
        md += `## ${change.filePath}\n`;
        md += `- **Time:** ${new Date(change.timestamp).toLocaleString()}\n`;
        md += `- **Type:** ${change.eventType}\n`;
        md += `- **Lines:** +${change.linesAdded}/-${change.linesDeleted}\n`;
        if (change.symbols.length > 0) {
          md += `- **Symbols:** ${change.symbols.join(', ')}\n`;
        }
        if (change.summary) {
          md += `- **Summary:** ${change.summary}\n`;
        }
        md += '\n```diff\n' + change.diff + '\n```\n\n---\n\n';
      }

      return md;
    }

    case 'html': {
      let html = '<!DOCTYPE html>\n<html>\n<head>\n';
      html += '<title>Code History Export</title>\n';
      html += '<style>body{font-family:system-ui;max-width:1200px;margin:0 auto;padding:20px}';
      html += '.change{border:1px solid #ccc;margin:10px 0;padding:10px;border-radius:4px}';
      html += '.diff{background:#f5f5f5;padding:10px;overflow-x:auto;font-family:monospace}';
      html += '.added{color:green}.deleted{color:red}</style>\n';
      html += '</head>\n<body>\n';
      html += `<h1>Code History Export</h1>\n`;
      html += `<p>Generated: ${new Date().toISOString()}</p>\n`;
      html += `<p>Total Changes: ${changes.length}</p>\n`;

      for (const change of changes) {
        html += '<div class="change">\n';
        html += `<h3>${escapeHtml(change.filePath)}</h3>\n`;
        html += `<p><strong>Time:</strong> ${new Date(change.timestamp).toLocaleString()}</p>\n`;
        html += `<p><strong>Type:</strong> ${change.eventType}</p>\n`;
        html += `<p><strong>Lines:</strong> +${change.linesAdded}/-${change.linesDeleted}</p>\n`;
        if (change.summary) {
          html += `<p><strong>Summary:</strong> ${escapeHtml(change.summary)}</p>\n`;
        }
        html += `<pre class="diff">${escapeHtml(change.diff)}</pre>\n`;
        html += '</div>\n';
      }

      html += '</body>\n</html>';
      return html;
    }
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
