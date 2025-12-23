/**
 * Restoration Engine for Code Historian
 * Handles safe code restoration with backup and undo support
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ChangeRecord,
  RestoreRequest,
  RestoreResult,
  ImpactAnalysis,
  ConflictInfo,
} from '../types';
import { MetadataDatabase } from '../database/metadata';
import { GitService } from './git';
import { diffService } from './diff';
import { logger } from '../utils/logger';
import { eventEmitter } from '../utils/events';
import { EVENTS, SNAPSHOTS_DIR } from '../constants';
import { generateId, formatTimestamp } from '../utils';

interface RestorationBackup {
  id: string;
  changeId: string;
  filePath: string;
  originalContent: string;
  timestamp: number;
}

export class RestorationEngine {
  private workspaceRoot: string;
  private database: MetadataDatabase;
  private gitService: GitService;
  private storagePath: string;
  private backups: Map<string, RestorationBackup> = new Map();
  private maxBackups = 50;

  constructor(workspaceRoot: string, database: MetadataDatabase, storagePath: string) {
    this.workspaceRoot = workspaceRoot;
    this.database = database;
    this.gitService = new GitService(workspaceRoot);
    this.storagePath = storagePath;
  }

  /**
   * Restore a change by ID
   */
  async restore(request: RestoreRequest): Promise<RestoreResult> {
    const { changeId, targetPath, createBranch, branchName, dryRun } = request;

    try {
      // Get the change
      const change = this.database.getChange(changeId);
      if (!change) {
        throw new Error(`Change not found: ${changeId}`);
      }

      // Determine file path
      const filePath = targetPath || path.join(this.workspaceRoot, change.filePath);

      // Check if file exists
      const fileExists = fs.existsSync(filePath);

      // Create backup of current state
      let backup: RestorationBackup | null = null;
      if (fileExists && !dryRun) {
        backup = await this.createBackup(changeId, filePath);
      }

      // Create branch if requested
      let createdBranch: string | undefined;
      if (createBranch && !dryRun) {
        const branch = branchName || `restore/${changeId.slice(0, 8)}-${Date.now()}`;
        const success = await this.gitService.createBranch(branch);
        if (success) {
          createdBranch = branch;
        }
      }

      if (dryRun) {
        // Return preview of what would happen
        return {
          success: true,
          changeId,
          filePath,
          linesRestored: change.linesAdded + change.linesDeleted,
          backupCreated: false,
          branchCreated: createdBranch,
        };
      }

      // Apply the restoration
      await this.applyRestoration(change, filePath, fileExists);

      // Emit event
      const result: RestoreResult = {
        success: true,
        changeId,
        filePath,
        linesRestored: change.linesAdded + change.linesDeleted,
        backupCreated: backup !== null,
        branchCreated: createdBranch,
      };

      eventEmitter.emit(EVENTS.RESTORE_COMPLETED, result);
      logger.info(`Restored change ${changeId} to ${filePath}`);

      return result;
    } catch (error) {
      logger.error(`Restoration failed for ${changeId}`, error as Error);
      return {
        success: false,
        changeId,
        filePath: targetPath || '',
        linesRestored: 0,
        backupCreated: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Apply restoration to file
   */
  private async applyRestoration(
    change: ChangeRecord,
    filePath: string,
    fileExists: boolean
  ): Promise<void> {
    const dir = path.dirname(filePath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    switch (change.eventType) {
      case 'create':
        // Restore a created file (delete it)
        if (fileExists) {
          fs.unlinkSync(filePath);
        }
        break;

      case 'delete':
        // Restore a deleted file (recreate it)
        if (change.contentBefore) {
          fs.writeFileSync(filePath, change.contentBefore, 'utf-8');
        } else {
          // Try to reconstruct from diff
          const content = this.reconstructFromDiff(change.diff, '');
          fs.writeFileSync(filePath, content, 'utf-8');
        }
        break;

      case 'modify':
        // Restore modified content
        if (fileExists) {
          const currentContent = fs.readFileSync(filePath, 'utf-8');
          const reversePatch = diffService.reversePatch(change.diff);
          const restored = diffService.applyPatch(currentContent, reversePatch);

          if (restored === false) {
            // Patch failed, try alternative restoration
            if (change.contentBefore) {
              fs.writeFileSync(filePath, change.contentBefore, 'utf-8');
            } else {
              throw new Error('Could not apply restoration patch');
            }
          } else {
            fs.writeFileSync(filePath, restored, 'utf-8');
          }
        } else if (change.contentBefore) {
          fs.writeFileSync(filePath, change.contentBefore, 'utf-8');
        }
        break;

      case 'rename':
        // For rename, we need the original path
        // This is more complex and might need additional context
        logger.warn('Rename restoration not fully implemented');
        break;
    }

    // Open the restored file in editor
    const uri = vscode.Uri.file(filePath);
    await vscode.window.showTextDocument(uri);
  }

  /**
   * Reconstruct content from diff
   * This applies the reverse of a diff to get previous content
   */
  private reconstructFromDiff(diff: string, baseContent: string): string {
    const diffLines = diff.split('\n');
    const baseLines = baseContent.split('\n');
    const result: string[] = [];

    // Parse the diff and apply in reverse
    let baseIndex = 0;

    for (const diffLine of diffLines) {
      if (diffLine.startsWith('@@')) {
        // Parse hunk header: @@ -start,count +start,count @@
        const match = diffLine.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          const targetStart = parseInt(match[2], 10) - 1;
          // Copy unchanged lines up to this point
          while (baseIndex < targetStart && baseIndex < baseLines.length) {
            result.push(baseLines[baseIndex]);
            baseIndex++;
          }
        }
      } else if (diffLine.startsWith('+') && !diffLine.startsWith('+++')) {
        // Added line in forward diff = skip in reverse (don't add to result)
        baseIndex++;
      } else if (diffLine.startsWith('-') && !diffLine.startsWith('---')) {
        // Removed line in forward diff = add back in reverse
        result.push(diffLine.substring(1));
      } else if (
        !diffLine.startsWith('---') &&
        !diffLine.startsWith('+++') &&
        diffLine.startsWith(' ')
      ) {
        // Context line
        result.push(diffLine.substring(1));
        baseIndex++;
      }
    }

    // Copy remaining lines
    while (baseIndex < baseLines.length) {
      result.push(baseLines[baseIndex]);
      baseIndex++;
    }

    return result.join('\n');
  }

  /**
   * Create backup of current file state
   */
  private async createBackup(changeId: string, filePath: string): Promise<RestorationBackup> {
    const backup: RestorationBackup = {
      id: generateId(),
      changeId,
      filePath,
      originalContent: fs.readFileSync(filePath, 'utf-8'),
      timestamp: Date.now(),
    };

    this.backups.set(backup.id, backup);

    // Save backup to disk
    const backupDir = path.join(this.storagePath, SNAPSHOTS_DIR, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupFile = path.join(backupDir, `${backup.id}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backup), 'utf-8');

    // Cleanup old backups
    this.cleanupBackups();

    logger.debug(`Created backup ${backup.id} for ${filePath}`);
    return backup;
  }

  /**
   * Undo a restoration
   */
  async undoRestoration(backupId: string): Promise<boolean> {
    const backup = this.backups.get(backupId);

    if (!backup) {
      // Try to load from disk
      const backupFile = path.join(this.storagePath, SNAPSHOTS_DIR, 'backups', `${backupId}.json`);

      if (!fs.existsSync(backupFile)) {
        logger.error(`Backup not found: ${backupId}`);
        return false;
      }

      const loadedBackup = JSON.parse(fs.readFileSync(backupFile, 'utf-8')) as RestorationBackup;
      this.backups.set(backupId, loadedBackup);
      return this.undoRestoration(backupId);
    }

    try {
      // Restore original content
      fs.writeFileSync(backup.filePath, backup.originalContent, 'utf-8');

      // Remove backup
      this.backups.delete(backupId);

      // Delete backup file
      const backupFile = path.join(this.storagePath, SNAPSHOTS_DIR, 'backups', `${backupId}.json`);
      if (fs.existsSync(backupFile)) {
        fs.unlinkSync(backupFile);
      }

      logger.info(`Undo restoration successful for ${backup.filePath}`);
      return true;
    } catch (error) {
      logger.error('Undo restoration failed', error as Error);
      return false;
    }
  }

  /**
   * Analyze impact of restoring a change
   */
  async analyzeImpact(changeId: string): Promise<ImpactAnalysis> {
    const change = this.database.getChange(changeId);
    if (!change) {
      throw new Error(`Change not found: ${changeId}`);
    }

    const filePath = path.join(this.workspaceRoot, change.filePath);
    const fileExists = fs.existsSync(filePath);

    const conflicts: ConflictInfo[] = [];
    let risk: 'low' | 'medium' | 'high' = 'low';

    // Check for conflicts with current file state
    if (fileExists && change.eventType === 'modify') {
      const currentContent = fs.readFileSync(filePath, 'utf-8');
      const reversePatch = diffService.reversePatch(change.diff);
      const canApply = diffService.applyPatch(currentContent, reversePatch);

      if (canApply === false) {
        conflicts.push({
          filePath: change.filePath,
          lineRange: [1, change.totalLines],
          description: 'File has changed since this modification. Manual merge may be needed.',
        });
        risk = 'high';
      }
    }

    // Check for recent changes to the same file
    const recentChanges = this.database.getChanges(
      change.workspaceId,
      {
        filePatterns: [change.filePath],
        timeRange: { start: change.timestamp, end: Date.now() },
      },
      10
    );

    if (recentChanges.length > 1) {
      risk = risk === 'low' ? 'medium' : risk;
      conflicts.push({
        filePath: change.filePath,
        lineRange: [1, change.totalLines],
        description: `${recentChanges.length - 1} changes have been made to this file since then.`,
      });
    }

    // Check if file was deleted
    if (change.eventType === 'modify' && !fileExists) {
      conflicts.push({
        filePath: change.filePath,
        lineRange: [1, 1],
        description: 'File no longer exists. Restoration will recreate it.',
      });
      risk = 'medium';
    }

    // Generate summary
    const summary = this.generateImpactSummary(change, conflicts, risk);

    return {
      filesAffected: 1,
      linesChanged: change.linesAdded + change.linesDeleted,
      symbolsAffected: change.symbols,
      potentialConflicts: conflicts,
      summary,
      risk,
    };
  }

  /**
   * Generate impact summary
   */
  private generateImpactSummary(
    change: ChangeRecord,
    conflicts: ConflictInfo[],
    risk: 'low' | 'medium' | 'high'
  ): string {
    const parts: string[] = [];

    parts.push(`Restoring ${change.eventType} to ${change.filePath}`);
    parts.push(`from ${formatTimestamp(change.timestamp)}.`);
    parts.push(`Risk level: ${risk}.`);

    if (change.linesAdded > 0 || change.linesDeleted > 0) {
      parts.push(`This will revert +${change.linesAdded}/-${change.linesDeleted} lines.`);
    }

    if (change.symbols.length > 0) {
      parts.push(`Affected symbols: ${change.symbols.join(', ')}.`);
    }

    if (conflicts.length > 0) {
      parts.push(`Warning: ${conflicts.length} potential conflict(s) detected.`);
    }

    return parts.join(' ');
  }

  /**
   * Preview restoration in diff view
   */
  async previewRestoration(changeId: string): Promise<void> {
    const change = this.database.getChange(changeId);
    if (!change) {
      throw new Error(`Change not found: ${changeId}`);
    }

    const filePath = path.join(this.workspaceRoot, change.filePath);

    if (!fs.existsSync(filePath)) {
      // Show what would be created
      if (change.contentBefore) {
        const doc = await vscode.workspace.openTextDocument({
          content: change.contentBefore,
          language: change.language,
        });
        await vscode.window.showTextDocument(doc);
      }
      return;
    }

    // Create temp file with restored content
    const currentContent = fs.readFileSync(filePath, 'utf-8');
    const reversePatch = diffService.reversePatch(change.diff);
    const restoredContent = diffService.applyPatch(currentContent, reversePatch);

    if (restoredContent === false) {
      throw new Error('Cannot preview: patch application failed');
    }

    // Create virtual documents for diff view
    const currentUri = vscode.Uri.file(filePath);

    // Write temp restored content
    const tempDir = path.join(this.storagePath, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = path.join(tempDir, `restored_${path.basename(filePath)}`);
    fs.writeFileSync(tempFile, restoredContent, 'utf-8');
    const restoredUri = vscode.Uri.file(tempFile);

    // Open diff view
    await vscode.commands.executeCommand(
      'vscode.diff',
      currentUri,
      restoredUri,
      `${path.basename(filePath)}: Current ↔ Restored`
    );
  }

  /**
   * Batch restore multiple changes
   */
  async batchRestore(changeIds: string[]): Promise<RestoreResult[]> {
    const results: RestoreResult[] = [];

    for (const changeId of changeIds) {
      const result = await this.restore({ changeId });
      results.push(result);

      if (!result.success) {
        // Stop on first failure
        break;
      }
    }

    return results;
  }

  /**
   * Get restoration history
   */
  getRestorationHistory(): RestorationBackup[] {
    return Array.from(this.backups.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Cleanup old backups
   */
  private cleanupBackups(): void {
    if (this.backups.size <= this.maxBackups) {
      return;
    }

    // Sort by timestamp and remove oldest
    const sorted = Array.from(this.backups.entries()).sort(
      ([, a], [, b]) => b.timestamp - a.timestamp
    );

    const toRemove = sorted.slice(this.maxBackups);

    for (const [id] of toRemove) {
      this.backups.delete(id);

      // Delete backup file
      const backupFile = path.join(this.storagePath, SNAPSHOTS_DIR, 'backups', `${id}.json`);
      if (fs.existsSync(backupFile)) {
        fs.unlinkSync(backupFile);
      }
    }

    logger.debug(`Cleaned up ${toRemove.length} old backups`);
  }

  /**
   * Load backups from disk on startup
   */
  async loadBackups(): Promise<void> {
    const backupDir = path.join(this.storagePath, SNAPSHOTS_DIR, 'backups');

    if (!fs.existsSync(backupDir)) {
      return;
    }

    const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(backupDir, file), 'utf-8');
        const backup = JSON.parse(content) as RestorationBackup;
        this.backups.set(backup.id, backup);
      } catch (error) {
        logger.warn(`Failed to load backup: ${file}`);
      }
    }

    logger.info(`Loaded ${this.backups.size} restoration backups`);
  }
}
