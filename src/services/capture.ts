/**
 * Change Capture Engine for Code Historian
 * Monitors workspace changes and captures them for indexing
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import type { ChangeRecord, ChangeMetadata, Session, CaptureConfig } from '../types';
import { MetadataDatabase } from '../database/metadata';
import { GitService } from './git';
import { diffService } from './diff';
import { eventEmitter } from '../utils/events';
import { logger } from '../utils/logger';
import { EVENTS, PERFORMANCE, DEFAULT_EXCLUDE_PATTERNS } from '../constants';
import {
  generateId,
  generateWorkspaceId,
  getLanguageFromPath,
  getFileExtension,
  matchesPatterns,
  getRelativePath,
  debounce,
  createSearchableText,
} from '../utils';

interface PendingChange {
  document: vscode.TextDocument;
  contentBefore: string;
  timestamp: number;
}

export class CaptureEngine {
  private context: vscode.ExtensionContext;
  private workspaceRoot: string;
  private workspaceId: string;
  private database: MetadataDatabase;
  private gitService: GitService;
  private config: CaptureConfig;

  private isCapturing: boolean = false;
  private currentSession: Session | null = null;
  private pendingChanges: Map<string, PendingChange> = new Map();
  private changeBuffer: ChangeRecord[] = [];
  private documentContents: Map<string, string> = new Map();

  private disposables: vscode.Disposable[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;

  constructor(
    context: vscode.ExtensionContext,
    workspaceRoot: string,
    database: MetadataDatabase,
    config: CaptureConfig
  ) {
    this.context = context;
    this.workspaceRoot = workspaceRoot;
    this.workspaceId = generateWorkspaceId(workspaceRoot);
    this.database = database;
    this.gitService = new GitService(workspaceRoot);
    this.config = config;
  }

  /**
   * Start capturing changes
   */
  async start(): Promise<void> {
    if (this.isCapturing) {
      logger.warn('Capture engine already running');
      return;
    }

    logger.info('Starting change capture engine');
    this.isCapturing = true;

    // Start or resume session
    this.currentSession = this.database.getActiveSession(this.workspaceId);
    if (!this.currentSession) {
      this.currentSession = this.database.createSession(this.workspaceId);
      eventEmitter.emit(EVENTS.SESSION_STARTED, this.currentSession);
      logger.info(`Started new session: ${this.currentSession.id}`);
    } else {
      logger.info(`Resumed existing session: ${this.currentSession.id}`);
    }

    // Capture initial state of open documents
    await this.captureInitialState();

    // Set up file watchers
    this.setupWatchers();

    logger.info('Change capture engine started');
  }

  /**
   * Stop capturing changes
   */
  async stop(): Promise<void> {
    if (!this.isCapturing) {
      return;
    }

    logger.info('Stopping change capture engine');
    this.isCapturing = false;

    // Flush any pending changes
    await this.flushChanges();

    // End current session
    if (this.currentSession) {
      this.database.endSession(this.currentSession.id);
      eventEmitter.emit(EVENTS.SESSION_ENDED, this.currentSession);
      this.currentSession = null;
    }

    // Dispose watchers
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];

    // Clear timeouts
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    logger.info('Change capture engine stopped');
  }

  /**
   * Pause capturing (keeps session active)
   */
  pause(): void {
    this.isCapturing = false;
    logger.info('Change capture paused');
  }

  /**
   * Resume capturing
   */
  resume(): void {
    this.isCapturing = true;
    logger.info('Change capture resumed');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CaptureConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Capture config updated');
  }

  /**
   * Get current session
   */
  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  /**
   * Capture initial state of open documents
   */
  private async captureInitialState(): Promise<void> {
    for (const document of vscode.workspace.textDocuments) {
      if (this.shouldCaptureDocument(document)) {
        this.documentContents.set(document.uri.toString(), document.getText());
      }
    }
  }

  /**
   * Set up VS Code watchers
   */
  private setupWatchers(): void {
    // Document open
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument(document => {
        if (this.shouldCaptureDocument(document)) {
          this.documentContents.set(document.uri.toString(), document.getText());
        }
      })
    );

    // Document change (debounced)
    const debouncedCapture = debounce(
      (document: vscode.TextDocument) => this.captureChange(document),
      this.config.debounceMs
    );

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (!this.isCapturing || !this.config.enabled) {
          return;
        }

        const document = event.document;
        if (!this.shouldCaptureDocument(document)) {
          return;
        }

        // Store the content before changes for diff
        const uri = document.uri.toString();
        if (!this.pendingChanges.has(uri)) {
          this.pendingChanges.set(uri, {
            document,
            contentBefore: this.documentContents.get(uri) || '',
            timestamp: Date.now(),
          });
        }

        debouncedCapture(document);
      })
    );

    // Document save
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(document => {
        if (this.shouldCaptureDocument(document)) {
          // Immediately capture on save
          this.captureChange(document, false);
        }
      })
    );

    // Document close
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument(document => {
        const uri = document.uri.toString();
        this.documentContents.delete(uri);
        this.pendingChanges.delete(uri);
      })
    );

    // File creation
    this.disposables.push(
      vscode.workspace.onDidCreateFiles(event => {
        for (const file of event.files) {
          this.captureFileEvent(file.fsPath, 'create');
        }
      })
    );

    // File deletion
    this.disposables.push(
      vscode.workspace.onDidDeleteFiles(event => {
        for (const file of event.files) {
          this.captureFileEvent(file.fsPath, 'delete');
        }
      })
    );

    // File rename
    this.disposables.push(
      vscode.workspace.onDidRenameFiles(event => {
        for (const file of event.files) {
          this.captureFileEvent(file.oldUri.fsPath, 'rename', file.newUri.fsPath);
        }
      })
    );

    // Schedule periodic flush
    this.scheduleFlush();
  }

  /**
   * Check if document should be captured
   */
  private shouldCaptureDocument(document: vscode.TextDocument): boolean {
    // Skip untitled documents
    if (document.uri.scheme !== 'file') {
      return false;
    }

    const filePath = document.uri.fsPath;
    const relativePath = getRelativePath(filePath, this.workspaceRoot);

    // Check file size
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > this.config.maxFileSizeKB * 1024) {
        return false;
      }
    } catch {
      return false;
    }

    // Check exclude patterns
    const excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...(this.config.excludePatterns || [])];

    if (matchesPatterns(relativePath, excludePatterns)) {
      return false;
    }

    // Check include patterns (if specified)
    if (this.config.includePatterns && this.config.includePatterns.length > 0) {
      if (!matchesPatterns(relativePath, this.config.includePatterns)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Capture a document change
   */
  private async captureChange(
    document: vscode.TextDocument,
    isAutoSave: boolean = true
  ): Promise<void> {
    if (!this.isCapturing || !this.currentSession) {
      return;
    }

    const uri = document.uri.toString();
    const pending = this.pendingChanges.get(uri);

    if (!pending) {
      return;
    }

    const contentBefore = pending.contentBefore;
    const contentAfter = document.getText();

    // Skip if no actual changes
    if (contentBefore === contentAfter) {
      this.pendingChanges.delete(uri);
      return;
    }

    try {
      const filePath = document.uri.fsPath;
      const relativePath = getRelativePath(filePath, this.workspaceRoot);
      const language = getLanguageFromPath(filePath);

      // Create diff
      const diffResult = diffService.createDiff(contentBefore, contentAfter, relativePath);

      // Skip if diff is too large
      if (diffResult.diff.length > PERFORMANCE.MAX_DIFF_SIZE_BYTES) {
        logger.warn(`Diff too large for ${relativePath}, skipping`);
        this.pendingChanges.delete(uri);
        this.documentContents.set(uri, contentAfter);
        return;
      }

      // Get git info
      const gitInfo = await this.gitService.getGitInfo();

      // Create change record
      const change: ChangeRecord = {
        id: generateId(),
        timestamp: Date.now(),
        workspaceId: this.workspaceId,
        sessionId: this.currentSession.id,
        filePath: relativePath,
        absolutePath: filePath,
        language,
        fileExtension: getFileExtension(filePath),
        eventType: 'modify',
        diff: diffResult.diff,
        linesAdded: diffResult.linesAdded,
        linesDeleted: diffResult.linesDeleted,
        totalLines: contentAfter.split('\n').length,
        contentBefore: undefined, // Don't store full content by default
        contentAfter: undefined,
        contextLines: this.extractContextLines(contentAfter, diffResult),
        symbols: [], // Will be populated by AST parser
        imports: [],
        gitBranch: gitInfo.branch,
        gitCommit: gitInfo.commit,
        gitAuthor: gitInfo.author,
        searchableText: createSearchableText(relativePath, diffResult.diff, []),
        metadata: this.createMetadata(isAutoSave),
      };

      // Add to buffer
      this.changeBuffer.push(change);

      // Update document content
      this.documentContents.set(uri, contentAfter);
      this.pendingChanges.delete(uri);

      // Emit event
      eventEmitter.emit(EVENTS.CHANGE_CAPTURED, change);

      // Check if we should flush
      if (this.changeBuffer.length >= PERFORMANCE.BATCH_COMMIT_SIZE) {
        await this.flushChanges();
      }

      logger.debug(
        `Captured change: ${relativePath} (+${diffResult.linesAdded}/-${diffResult.linesDeleted})`
      );
    } catch (error) {
      logger.error(`Failed to capture change for ${document.uri.fsPath}`, error as Error);
      this.pendingChanges.delete(uri);
    }
  }

  /**
   * Capture file system events (create, delete, rename)
   */
  private async captureFileEvent(
    filePath: string,
    eventType: 'create' | 'delete' | 'rename',
    newPath?: string
  ): Promise<void> {
    if (!this.isCapturing || !this.currentSession) {
      return;
    }

    const relativePath = getRelativePath(filePath, this.workspaceRoot);
    const language = getLanguageFromPath(filePath);
    const gitInfo = await this.gitService.getGitInfo();

    let diff = '';
    if (eventType === 'create') {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        diff = `+++ ${relativePath}\n${content
          .split('\n')
          .map(l => `+ ${l}`)
          .join('\n')}`;
      } catch {
        diff = `+++ ${relativePath}\n+ [New file created]`;
      }
    } else if (eventType === 'delete') {
      diff = `--- ${relativePath}\n- [File deleted]`;
    } else if (eventType === 'rename' && newPath) {
      const newRelativePath = getRelativePath(newPath, this.workspaceRoot);
      diff = `--- ${relativePath}\n+++ ${newRelativePath}\n[File renamed]`;
    }

    const change: ChangeRecord = {
      id: generateId(),
      timestamp: Date.now(),
      workspaceId: this.workspaceId,
      sessionId: this.currentSession.id,
      filePath:
        eventType === 'rename' && newPath
          ? getRelativePath(newPath, this.workspaceRoot)
          : relativePath,
      absolutePath: eventType === 'rename' && newPath ? newPath : filePath,
      language,
      fileExtension: getFileExtension(filePath),
      eventType,
      diff,
      linesAdded: eventType === 'create' ? 1 : 0,
      linesDeleted: eventType === 'delete' ? 1 : 0,
      totalLines: 0,
      contextLines: [],
      symbols: [],
      imports: [],
      gitBranch: gitInfo.branch,
      gitCommit: gitInfo.commit,
      gitAuthor: gitInfo.author,
      searchableText: createSearchableText(relativePath, diff, []),
      metadata: this.createMetadata(false),
    };

    this.changeBuffer.push(change);
    eventEmitter.emit(EVENTS.CHANGE_CAPTURED, change);

    logger.debug(`Captured ${eventType}: ${relativePath}`);
  }

  /**
   * Extract context lines from diff
   */
  private extractContextLines(
    content: string,
    diffResult: { hunks: Array<{ newStart: number; newLines: number }> }
  ): string[] {
    const lines = content.split('\n');
    const contextLines: string[] = [];

    for (const hunk of diffResult.hunks) {
      const start = Math.max(0, hunk.newStart - PERFORMANCE.MAX_CONTEXT_LINES - 1);
      const end = Math.min(
        lines.length,
        hunk.newStart + hunk.newLines + PERFORMANCE.MAX_CONTEXT_LINES
      );
      contextLines.push(...lines.slice(start, end));
    }

    return contextLines.slice(0, 20); // Limit context lines
  }

  /**
   * Create change metadata
   */
  private createMetadata(isAutoSave: boolean): ChangeMetadata {
    return {
      editorVersion: vscode.version,
      extensionVersion: this.context.extension.packageJSON.version,
      os: process.platform,
      isAutoSave,
      triggerKind: isAutoSave ? 'auto' : 'manual',
    };
  }

  /**
   * Flush changes to database
   */
  private async flushChanges(): Promise<void> {
    if (this.changeBuffer.length === 0) {
      return;
    }

    const changes = [...this.changeBuffer];
    this.changeBuffer = [];

    try {
      this.database.insertChanges(changes);

      // Update session stats
      if (this.currentSession) {
        const filesModified = [...new Set(changes.map(c => c.filePath))];
        const currentFiles = new Set(this.currentSession.filesModified);
        filesModified.forEach(f => currentFiles.add(f));

        this.currentSession.totalChanges += changes.length;
        this.currentSession.filesModified = [...currentFiles];

        this.database.updateSessionStats(
          this.currentSession.id,
          this.currentSession.totalChanges,
          this.currentSession.filesModified
        );
      }

      logger.debug(`Flushed ${changes.length} changes to database`);
    } catch (error) {
      logger.error('Failed to flush changes', error as Error);
      // Re-add changes to buffer for retry
      this.changeBuffer.unshift(...changes);
    }
  }

  /**
   * Schedule periodic flush
   */
  private scheduleFlush(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    this.flushTimeout = setTimeout(async () => {
      await this.flushChanges();
      if (this.isCapturing) {
        this.scheduleFlush();
      }
    }, PERFORMANCE.BATCH_COMMIT_INTERVAL_MS);
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stop();
    this.documentContents.clear();
    this.pendingChanges.clear();
    this.changeBuffer = [];
  }
}
