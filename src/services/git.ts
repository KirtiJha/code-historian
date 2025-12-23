/**
 * Git Service for Code Historian
 * Handles git operations and metadata extraction
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export interface GitInfo {
  branch?: string;
  commit?: string;
  author?: string;
  isGitRepo: boolean;
}

export interface GitDiff {
  filePath: string;
  diff: string;
  linesAdded: number;
  linesDeleted: number;
}

export class GitService {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Check if workspace is a git repository
   */
  async isGitRepository(): Promise<boolean> {
    try {
      await this.runGitCommand('rev-parse', ['--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string | undefined> {
    try {
      const result = await this.runGitCommand('rev-parse', ['--abbrev-ref', 'HEAD']);
      return result.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Get current commit hash
   */
  async getCurrentCommit(): Promise<string | undefined> {
    try {
      const result = await this.runGitCommand('rev-parse', ['HEAD']);
      return result.trim().substring(0, 8);
    } catch {
      return undefined;
    }
  }

  /**
   * Get current author
   */
  async getCurrentAuthor(): Promise<string | undefined> {
    try {
      const result = await this.runGitCommand('config', ['user.name']);
      return result.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Get git info for current state
   */
  async getGitInfo(): Promise<GitInfo> {
    const isGitRepo = await this.isGitRepository();
    
    if (!isGitRepo) {
      return { isGitRepo: false };
    }

    const [branch, commit, author] = await Promise.all([
      this.getCurrentBranch(),
      this.getCurrentCommit(),
      this.getCurrentAuthor(),
    ]);

    return {
      isGitRepo: true,
      branch,
      commit,
      author,
    };
  }

  /**
   * Get diff for a specific file
   */
  async getFileDiff(filePath: string): Promise<GitDiff | null> {
    try {
      const relativePath = path.relative(this.workspaceRoot, filePath);
      const diff = await this.runGitCommand('diff', ['--', relativePath]);
      
      if (!diff.trim()) {
        return null;
      }

      const { linesAdded, linesDeleted } = this.parseDiffStats(diff);

      return {
        filePath: relativePath,
        diff,
        linesAdded,
        linesDeleted,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get staged diff for a file
   */
  async getStagedDiff(filePath: string): Promise<GitDiff | null> {
    try {
      const relativePath = path.relative(this.workspaceRoot, filePath);
      const diff = await this.runGitCommand('diff', ['--cached', '--', relativePath]);
      
      if (!diff.trim()) {
        return null;
      }

      const { linesAdded, linesDeleted } = this.parseDiffStats(diff);

      return {
        filePath: relativePath,
        diff,
        linesAdded,
        linesDeleted,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get file content at specific commit
   */
  async getFileAtCommit(filePath: string, commit: string): Promise<string | null> {
    try {
      const relativePath = path.relative(this.workspaceRoot, filePath);
      const content = await this.runGitCommand('show', [`${commit}:${relativePath}`]);
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Get commit history for a file
   */
  async getFileHistory(
    filePath: string,
    maxCommits: number = 50
  ): Promise<Array<{
    commit: string;
    author: string;
    date: string;
    message: string;
  }>> {
    try {
      const relativePath = path.relative(this.workspaceRoot, filePath);
      const log = await this.runGitCommand('log', [
        `--max-count=${maxCommits}`,
        '--format=%H|%an|%ai|%s',
        '--',
        relativePath,
      ]);

      const lines = log.trim().split('\n').filter(Boolean);
      return lines.map(line => {
        const [commit, author, date, message] = line.split('|');
        return { commit, author, date, message };
      });
    } catch {
      return [];
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(branchName: string): Promise<boolean> {
    try {
      await this.runGitCommand('checkout', ['-b', branchName]);
      return true;
    } catch (error) {
      logger.error(`Failed to create branch: ${branchName}`, error as Error);
      return false;
    }
  }

  /**
   * Stash current changes
   */
  async stash(message?: string): Promise<boolean> {
    try {
      const args = message ? ['push', '-m', message] : ['push'];
      await this.runGitCommand('stash', args);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Apply stash
   */
  async stashApply(): Promise<boolean> {
    try {
      await this.runGitCommand('stash', ['apply']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if file is ignored by git
   */
  async isIgnored(filePath: string): Promise<boolean> {
    try {
      const relativePath = path.relative(this.workspaceRoot, filePath);
      await this.runGitCommand('check-ignore', ['-q', relativePath]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get list of modified files
   */
  async getModifiedFiles(): Promise<string[]> {
    try {
      const result = await this.runGitCommand('diff', ['--name-only']);
      return result.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Get list of staged files
   */
  async getStagedFiles(): Promise<string[]> {
    try {
      const result = await this.runGitCommand('diff', ['--cached', '--name-only']);
      return result.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Parse diff statistics
   */
  private parseDiffStats(diff: string): { linesAdded: number; linesDeleted: number } {
    let linesAdded = 0;
    let linesDeleted = 0;

    const lines = diff.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        linesAdded++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        linesDeleted++;
      }
    }

    return { linesAdded, linesDeleted };
  }

  /**
   * Run a git command
   */
  private async runGitCommand(command: string, args: string[] = []): Promise<string> {
    const fullCommand = `git ${command} ${args.join(' ')}`;
    
    try {
      const { stdout } = await execAsync(fullCommand, {
        cwd: this.workspaceRoot,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });
      return stdout;
    } catch (error) {
      throw error;
    }
  }
}
