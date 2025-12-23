/**
 * SQLite Database Layer for Code Historian
 * Uses sql.js (pure JavaScript SQLite) for cross-platform compatibility
 */

import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import type { ChangeRecord, Session, HistoryStats, SearchFilters } from '../types';
import { TABLES, METADATA_DB_NAME } from '../constants';
import { logger } from '../utils/logger';
import { generateId } from '../utils';

// sql.js types
type SqlValue = string | number | null | Uint8Array;
type SqlRow = SqlValue[];

interface SqlJsDatabase {
  run(sql: string, params?: SqlValue[]): void;
  exec(sql: string, params?: SqlValue[]): Array<{ columns: string[]; values: SqlRow[] }>;
  export(): Uint8Array;
  close(): void;
  getRowsModified(): number;
}

interface SqlJsStatic {
  Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
}

interface InitSqlJsOptions {
  wasmBinary?: ArrayBuffer;
}

// Dynamic import for sql.js
let initSqlJs: (options?: InitSqlJsOptions) => Promise<SqlJsStatic>;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  initSqlJs = require('sql.js');
} catch {
  // Will be loaded dynamically
}

/**
 * Download WASM binary from CDN
 */
async function downloadWasm(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadWasm(redirectUrl).then(resolve).catch(reject);
          return;
        }
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download WASM: ${response.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

export class MetadataDatabase {
  private db: SqlJsDatabase | null = null;
  private storagePath: string;
  private dbPath: string;
  private wasmPath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private isDirty: boolean = false;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.dbPath = path.join(storagePath, METADATA_DB_NAME);
    this.wasmPath = path.join(storagePath, 'sql-wasm.wasm');
  }

  /**
   * Initialize the database connection and create tables
   */
  async initialize(): Promise<void> {
    try {
      // Ensure storage directory exists
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }

      // Get or download WASM binary
      let wasmBinary: ArrayBuffer;
      if (fs.existsSync(this.wasmPath)) {
        const buffer = fs.readFileSync(this.wasmPath);
        wasmBinary = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } else {
        logger.info('Downloading sql.js WASM binary...');
        wasmBinary = await downloadWasm('https://sql.js.org/dist/sql-wasm.wasm');
        // Cache it for future use
        fs.writeFileSync(this.wasmPath, Buffer.from(wasmBinary));
        logger.info('WASM binary cached');
      }

      // Initialize sql.js with the WASM binary
      const SQL = await initSqlJs({ wasmBinary });

      // Load existing database or create new one
      if (fs.existsSync(this.dbPath)) {
        const buffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(buffer);
      } else {
        this.db = new SQL.Database();
      }

      this.createTables();
      this.createIndexes();
      this.scheduleSave();

      logger.info(`Database initialized at ${this.dbPath}`);
    } catch (error) {
      logger.error('Failed to initialize database', error as Error);
      throw error;
    }
  }

  /**
   * Schedule periodic database saves
   */
  private scheduleSave(): void {
    // Save every 30 seconds if dirty
    this.saveTimer = setInterval(() => {
      if (this.isDirty) {
        this.saveToFile();
      }
    }, 30000);
  }

  /**
   * Save database to file
   */
  private saveToFile(): void {
    if (!this.db) return;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
      this.isDirty = false;
    } catch (error) {
      logger.error('Failed to save database', error as Error);
    }
  }

  /**
   * Mark database as dirty (needs save)
   */
  private markDirty(): void {
    this.isDirty = true;
  }

  /**
   * Create database tables
   */
  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Changes table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLES.CHANGES} (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        absolute_path TEXT NOT NULL,
        language TEXT NOT NULL,
        file_extension TEXT NOT NULL,
        event_type TEXT NOT NULL,
        diff TEXT NOT NULL,
        diff_compressed BLOB,
        lines_added INTEGER NOT NULL DEFAULT 0,
        lines_deleted INTEGER NOT NULL DEFAULT 0,
        total_lines INTEGER NOT NULL DEFAULT 0,
        content_before TEXT,
        content_after TEXT,
        context_lines TEXT,
        symbols TEXT,
        imports TEXT,
        active_function TEXT,
        active_class TEXT,
        git_branch TEXT,
        git_commit TEXT,
        git_author TEXT,
        embedding_id TEXT,
        summary TEXT,
        searchable_text TEXT,
        metadata TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      )
    `);

    // Sessions table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLES.SESSIONS} (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        total_changes INTEGER NOT NULL DEFAULT 0,
        files_modified TEXT,
        summary TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      )
    `);

    // Settings table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLES.SETTINGS} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      )
    `);

    // Stats table (for caching computed statistics)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLES.STATS} (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        stat_type TEXT NOT NULL,
        stat_value TEXT NOT NULL,
        computed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      )
    `);

    this.markDirty();
  }

  /**
   * Create database indexes for faster queries
   */
  private createIndexes(): void {
    if (!this.db) throw new Error('Database not initialized');

    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_changes_timestamp ON ${TABLES.CHANGES}(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_changes_workspace ON ${TABLES.CHANGES}(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_changes_session ON ${TABLES.CHANGES}(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_changes_file_path ON ${TABLES.CHANGES}(file_path)`,
      `CREATE INDEX IF NOT EXISTS idx_changes_language ON ${TABLES.CHANGES}(language)`,
      `CREATE INDEX IF NOT EXISTS idx_changes_event_type ON ${TABLES.CHANGES}(event_type)`,
      `CREATE INDEX IF NOT EXISTS idx_changes_git_branch ON ${TABLES.CHANGES}(git_branch)`,
      `CREATE INDEX IF NOT EXISTS idx_changes_embedding ON ${TABLES.CHANGES}(embedding_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON ${TABLES.SESSIONS}(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_active ON ${TABLES.SESSIONS}(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_time ON ${TABLES.SESSIONS}(start_time)`,
    ];

    for (const index of indexes) {
      this.db.run(index);
    }

    this.markDirty();
  }

  /**
   * Insert a change record
   */
  insertChange(change: ChangeRecord): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO ${TABLES.CHANGES} (
        id, timestamp, workspace_id, session_id, file_path, absolute_path,
        language, file_extension, event_type, diff, diff_compressed,
        lines_added, lines_deleted, total_lines, content_before, content_after,
        context_lines, symbols, imports, active_function, active_class,
        git_branch, git_commit, git_author, embedding_id, summary,
        searchable_text, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        change.id,
        change.timestamp,
        change.workspaceId,
        change.sessionId,
        change.filePath,
        change.absolutePath,
        change.language,
        change.fileExtension,
        change.eventType,
        change.diff,
        change.diffCompressed || null,
        change.linesAdded,
        change.linesDeleted,
        change.totalLines,
        change.contentBefore || null,
        change.contentAfter || null,
        JSON.stringify(change.contextLines),
        JSON.stringify(change.symbols),
        JSON.stringify(change.imports),
        change.activeFunction || null,
        change.activeClass || null,
        change.gitBranch || null,
        change.gitCommit || null,
        change.gitAuthor || null,
        change.embeddingId || null,
        change.summary || null,
        change.searchableText,
        JSON.stringify(change.metadata),
      ]
    );

    this.markDirty();
  }

  /**
   * Insert multiple changes
   */
  insertChanges(changes: ChangeRecord[]): void {
    if (!this.db) throw new Error('Database not initialized');

    for (const change of changes) {
      this.insertChange(change);
    }
  }

  /**
   * Get a change by ID
   */
  getChange(id: string): ChangeRecord | null {
    if (!this.db) throw new Error('Database not initialized');

    const results = this.db.exec(
      `SELECT * FROM ${TABLES.CHANGES} WHERE id = ?`,
      [id]
    );

    if (results.length === 0 || results[0].values.length === 0) {
      return null;
    }

    return this.resultToChangeRecord(results[0].columns, results[0].values[0]);
  }

  /**
   * Get changes with optional filters
   */
  getChanges(
    workspaceId: string,
    filters?: SearchFilters,
    limit: number = 100,
    offset: number = 0
  ): ChangeRecord[] {
    if (!this.db) throw new Error('Database not initialized');

    let query = `SELECT * FROM ${TABLES.CHANGES} WHERE workspace_id = ?`;
    const params: unknown[] = [workspaceId];

    if (filters) {
      if (filters.timeRange) {
        query += ' AND timestamp >= ? AND timestamp <= ?';
        params.push(filters.timeRange.start, filters.timeRange.end);
      }

      if (filters.filePatterns && filters.filePatterns.length > 0) {
        const patterns = filters.filePatterns.map(() => 'file_path GLOB ?').join(' OR ');
        query += ` AND (${patterns})`;
        params.push(...filters.filePatterns);
      }

      if (filters.languages && filters.languages.length > 0) {
        const placeholders = filters.languages.map(() => '?').join(',');
        query += ` AND language IN (${placeholders})`;
        params.push(...filters.languages);
      }

      if (filters.eventTypes && filters.eventTypes.length > 0) {
        const placeholders = filters.eventTypes.map(() => '?').join(',');
        query += ` AND event_type IN (${placeholders})`;
        params.push(...filters.eventTypes);
      }

      if (filters.branches && filters.branches.length > 0) {
        const placeholders = filters.branches.map(() => '?').join(',');
        query += ` AND git_branch IN (${placeholders})`;
        params.push(...filters.branches);
      }

      if (filters.sessions && filters.sessions.length > 0) {
        const placeholders = filters.sessions.map(() => '?').join(',');
        query += ` AND session_id IN (${placeholders})`;
        params.push(...filters.sessions);
      }
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const results = this.db.exec(query, params as SqlValue[]);

    if (results.length === 0) {
      return [];
    }

    return results[0].values.map((row: SqlRow) =>
      this.resultToChangeRecord(results[0].columns, row)
    );
  }

  /**
   * Search changes by text (simple LIKE search since sql.js doesn't support FTS5)
   */
  searchChanges(
    workspaceId: string,
    query: string,
    limit: number = 50
  ): Array<{ change: ChangeRecord; rank: number }> {
    if (!this.db) throw new Error('Database not initialized');

    const searchTerm = `%${query}%`;
    const results = this.db.exec(
      `SELECT * FROM ${TABLES.CHANGES}
       WHERE workspace_id = ?
         AND (file_path LIKE ? OR diff LIKE ? OR symbols LIKE ? OR summary LIKE ? OR searchable_text LIKE ?)
       ORDER BY timestamp DESC
       LIMIT ?`,
      [workspaceId, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, limit]
    );

    if (results.length === 0) {
      return [];
    }

    return results[0].values.map((row: SqlRow, index: number) => ({
      change: this.resultToChangeRecord(results[0].columns, row),
      rank: index + 1,
    }));
  }

  /**
   * Update embedding ID for a change
   */
  updateEmbeddingId(changeId: string, embeddingId: string): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `UPDATE ${TABLES.CHANGES} SET embedding_id = ? WHERE id = ?`,
      [embeddingId, changeId]
    );
    this.markDirty();
  }

  /**
   * Update summary for a change
   */
  updateSummary(changeId: string, summary: string): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `UPDATE ${TABLES.CHANGES} SET summary = ? WHERE id = ?`,
      [summary, changeId]
    );
    this.markDirty();
  }

  /**
   * Get changes without embeddings
   */
  getChangesWithoutEmbeddings(workspaceId: string, limit: number = 100): ChangeRecord[] {
    if (!this.db) throw new Error('Database not initialized');

    const results = this.db.exec(
      `SELECT * FROM ${TABLES.CHANGES}
       WHERE workspace_id = ? AND embedding_id IS NULL
       ORDER BY timestamp DESC
       LIMIT ?`,
      [workspaceId, limit]
    );

    if (results.length === 0) {
      return [];
    }

    return results[0].values.map((row) =>
      this.resultToChangeRecord(results[0].columns, row)
    );
  }

  /**
   * Create a new session
   */
  createSession(workspaceId: string): Session {
    if (!this.db) throw new Error('Database not initialized');

    const session: Session = {
      id: generateId(),
      workspaceId,
      startTime: Date.now(),
      isActive: true,
      totalChanges: 0,
      filesModified: [],
    };

    this.db.run(
      `INSERT INTO ${TABLES.SESSIONS} (
        id, workspace_id, start_time, is_active, total_changes, files_modified
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [session.id, session.workspaceId, session.startTime, 1, 0, JSON.stringify([])]
    );

    this.markDirty();
    return session;
  }

  /**
   * End a session
   */
  endSession(sessionId: string, summary?: string): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `UPDATE ${TABLES.SESSIONS}
       SET end_time = ?, is_active = 0, summary = ?
       WHERE id = ?`,
      [Date.now(), summary || null, sessionId]
    );
    this.markDirty();
  }

  /**
   * Get active session for workspace
   */
  getActiveSession(workspaceId: string): Session | null {
    if (!this.db) throw new Error('Database not initialized');

    const results = this.db.exec(
      `SELECT * FROM ${TABLES.SESSIONS}
       WHERE workspace_id = ? AND is_active = 1
       ORDER BY start_time DESC
       LIMIT 1`,
      [workspaceId]
    );

    if (results.length === 0 || results[0].values.length === 0) {
      return null;
    }

    return this.resultToSession(results[0].columns, results[0].values[0]);
  }

  /**
   * Update session stats
   */
  updateSessionStats(sessionId: string, totalChanges: number, filesModified: string[]): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `UPDATE ${TABLES.SESSIONS}
       SET total_changes = ?, files_modified = ?
       WHERE id = ?`,
      [totalChanges, JSON.stringify(filesModified), sessionId]
    );
    this.markDirty();
  }

  /**
   * Get sessions for workspace
   */
  getSessions(workspaceId: string, limit: number = 50): Session[] {
    if (!this.db) throw new Error('Database not initialized');

    const results = this.db.exec(
      `SELECT * FROM ${TABLES.SESSIONS}
       WHERE workspace_id = ?
       ORDER BY start_time DESC
       LIMIT ?`,
      [workspaceId, limit]
    );

    if (results.length === 0) {
      return [];
    }

    return results[0].values.map((row: SqlRow) =>
      this.resultToSession(results[0].columns, row)
    );
  }

  /**
   * Get history statistics
   */
  getStats(workspaceId: string): HistoryStats {
    if (!this.db) throw new Error('Database not initialized');

    // Total counts
    const countResults = this.db.exec(
      `SELECT 
        COUNT(*) as totalChanges,
        COUNT(DISTINCT file_path) as totalFiles,
        SUM(lines_added) as totalLinesAdded,
        SUM(lines_deleted) as totalLinesDeleted,
        MIN(timestamp) as oldestChange,
        MAX(timestamp) as newestChange
      FROM ${TABLES.CHANGES}
      WHERE workspace_id = ?`,
      [workspaceId]
    );

    const counts = countResults.length > 0 && countResults[0].values.length > 0
      ? {
          totalChanges: countResults[0].values[0][0] as number || 0,
          totalFiles: countResults[0].values[0][1] as number || 0,
          totalLinesAdded: countResults[0].values[0][2] as number || 0,
          totalLinesDeleted: countResults[0].values[0][3] as number || 0,
          oldestChange: countResults[0].values[0][4] as number || 0,
          newestChange: countResults[0].values[0][5] as number || 0,
        }
      : { totalChanges: 0, totalFiles: 0, totalLinesAdded: 0, totalLinesDeleted: 0, oldestChange: 0, newestChange: 0 };

    // Session count
    const sessionResults = this.db.exec(
      `SELECT COUNT(*) as count FROM ${TABLES.SESSIONS} WHERE workspace_id = ?`,
      [workspaceId]
    );
    const sessionCount = sessionResults.length > 0 && sessionResults[0].values.length > 0
      ? sessionResults[0].values[0][0] as number
      : 0;

    // Top languages
    const langResults = this.db.exec(
      `SELECT language, COUNT(*) as count
       FROM ${TABLES.CHANGES}
       WHERE workspace_id = ?
       GROUP BY language
       ORDER BY count DESC
       LIMIT 10`,
      [workspaceId]
    );
    const topLanguages = langResults.length > 0
      ? langResults[0].values.map((row: SqlRow) => ({
          language: row[0] as string,
          count: row[1] as number,
        }))
      : [];

    // Top files
    const fileResults = this.db.exec(
      `SELECT file_path as filePath, COUNT(*) as count
       FROM ${TABLES.CHANGES}
       WHERE workspace_id = ?
       GROUP BY file_path
       ORDER BY count DESC
       LIMIT 10`,
      [workspaceId]
    );
    const topFiles = fileResults.length > 0
      ? fileResults[0].values.map((row: SqlRow) => ({
          filePath: row[0] as string,
          count: row[1] as number,
        }))
      : [];

    // Changes by day (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const dayResults = this.db.exec(
      `SELECT 
        date(timestamp / 1000, 'unixepoch') as date,
        COUNT(*) as count
       FROM ${TABLES.CHANGES}
       WHERE workspace_id = ? AND timestamp >= ?
       GROUP BY date
       ORDER BY date DESC`,
      [workspaceId, thirtyDaysAgo]
    );
    const changesByDay = dayResults.length > 0
      ? dayResults[0].values.map((row: SqlRow) => ({
          date: row[0] as string,
          count: row[1] as number,
        }))
      : [];

    // Storage size
    let storageMB = 0;
    if (fs.existsSync(this.dbPath)) {
      const stats = fs.statSync(this.dbPath);
      storageMB = stats.size / (1024 * 1024);
    }

    return {
      totalChanges: counts.totalChanges,
      totalFiles: counts.totalFiles,
      totalSessions: sessionCount,
      totalLinesChanged: counts.totalLinesAdded + counts.totalLinesDeleted,
      oldestChange: counts.oldestChange,
      newestChange: counts.newestChange,
      topLanguages,
      topFiles,
      changesByDay,
      storageUsedMB: Math.round(storageMB * 100) / 100,
    };
  }

  /**
   * Delete old changes (retention policy)
   */
  deleteOldChanges(workspaceId: string, maxAgeDays: number): number {
    if (!this.db) throw new Error('Database not initialized');

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    this.db.run(
      `DELETE FROM ${TABLES.CHANGES}
       WHERE workspace_id = ? AND timestamp < ?`,
      [workspaceId, cutoff]
    );

    this.markDirty();
    return this.db.getRowsModified();
  }

  /**
   * Clear all history for workspace
   */
  clearHistory(workspaceId: string): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(`DELETE FROM ${TABLES.CHANGES} WHERE workspace_id = ?`, [workspaceId]);
    this.db.run(`DELETE FROM ${TABLES.SESSIONS} WHERE workspace_id = ?`, [workspaceId]);
    this.markDirty();
  }

  /**
   * Vacuum database to reclaim space
   */
  vacuum(): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run('VACUUM');
    this.markDirty();
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    if (this.db) {
      // Final save
      this.saveToFile();
      this.db.close();
      this.db = null;
      logger.info('Database connection closed');
    }
  }

  /**
   * Convert sql.js result to ChangeRecord
   */
  private resultToChangeRecord(columns: string[], values: unknown[]): ChangeRecord {
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      row[col] = values[i];
    });

    return {
      id: row.id as string,
      timestamp: row.timestamp as number,
      workspaceId: row.workspace_id as string,
      sessionId: row.session_id as string,
      filePath: row.file_path as string,
      absolutePath: row.absolute_path as string,
      language: row.language as string,
      fileExtension: row.file_extension as string,
      eventType: row.event_type as ChangeRecord['eventType'],
      diff: row.diff as string,
      diffCompressed: row.diff_compressed as Buffer | undefined,
      linesAdded: row.lines_added as number,
      linesDeleted: row.lines_deleted as number,
      totalLines: row.total_lines as number,
      contentBefore: row.content_before as string | undefined,
      contentAfter: row.content_after as string | undefined,
      contextLines: JSON.parse((row.context_lines as string) || '[]'),
      symbols: JSON.parse((row.symbols as string) || '[]'),
      imports: JSON.parse((row.imports as string) || '[]'),
      activeFunction: row.active_function as string | undefined,
      activeClass: row.active_class as string | undefined,
      gitBranch: row.git_branch as string | undefined,
      gitCommit: row.git_commit as string | undefined,
      gitAuthor: row.git_author as string | undefined,
      embeddingId: row.embedding_id as string | undefined,
      summary: row.summary as string | undefined,
      searchableText: row.searchable_text as string,
      metadata: JSON.parse(row.metadata as string),
    };
  }

  /**
   * Convert sql.js result to Session
   */
  private resultToSession(columns: string[], values: unknown[]): Session {
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      row[col] = values[i];
    });

    return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      startTime: row.start_time as number,
      endTime: row.end_time as number | undefined,
      isActive: (row.is_active as number) === 1,
      totalChanges: row.total_changes as number,
      filesModified: JSON.parse((row.files_modified as string) || '[]'),
      summary: row.summary as string | undefined,
    };
  }
}
