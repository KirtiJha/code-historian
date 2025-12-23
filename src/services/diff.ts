/**
 * Diff Service for Code Historian
 * Handles creating and parsing unified diffs
 */

import * as Diff from 'diff';
import { logger } from '../utils/logger';

export interface DiffResult {
  diff: string;
  linesAdded: number;
  linesDeleted: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface DiffChange {
  value: string;
  added?: boolean;
  removed?: boolean;
  count?: number;
}

export class DiffService {
  /**
   * Create a unified diff between two strings
   */
  createDiff(
    oldContent: string,
    newContent: string,
    fileName: string = 'file',
    contextLines: number = 3
  ): DiffResult {
    try {
      const patch = Diff.createPatch(
        fileName,
        oldContent,
        newContent,
        'old',
        'new',
        { context: contextLines }
      );

      const hunks = this.parseHunks(patch);
      const { linesAdded, linesDeleted } = this.countChanges(patch);

      return {
        diff: patch,
        linesAdded,
        linesDeleted,
        hunks,
      };
    } catch (error) {
      logger.error('Failed to create diff', error as Error);
      return {
        diff: '',
        linesAdded: 0,
        linesDeleted: 0,
        hunks: [],
      };
    }
  }

  /**
   * Create a character-level diff for highlighting
   */
  createCharDiff(oldContent: string, newContent: string): DiffChange[] {
    return Diff.diffChars(oldContent, newContent);
  }

  /**
   * Create a word-level diff
   */
  createWordDiff(oldContent: string, newContent: string): DiffChange[] {
    return Diff.diffWords(oldContent, newContent);
  }

  /**
   * Create a line-level diff
   */
  createLineDiff(oldContent: string, newContent: string): DiffChange[] {
    return Diff.diffLines(oldContent, newContent);
  }

  /**
   * Apply a patch to content
   */
  applyPatch(content: string, patch: string): string | false {
    const result = Diff.applyPatch(content, patch);
    return result;
  }

  /**
   * Reverse a patch
   */
  reversePatch(patch: string): string {
    // Parse the patch and swap + and - lines
    const lines = patch.split('\n');
    const reversed: string[] = [];

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        reversed.push('-' + line.substring(1));
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        reversed.push('+' + line.substring(1));
      } else if (line.startsWith('@@')) {
        // Swap old and new line numbers in hunk header
        const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)/);
        if (match) {
          const [, oldStart, oldCount, newStart, newCount, rest] = match;
          reversed.push(`@@ -${newStart},${newCount || '1'} +${oldStart},${oldCount || '1'} @@${rest || ''}`);
        } else {
          reversed.push(line);
        }
      } else if (line.startsWith('---')) {
        reversed.push(line.replace('---', '+++'));
      } else if (line.startsWith('+++')) {
        reversed.push(line.replace('+++', '---'));
      } else {
        reversed.push(line);
      }
    }

    return reversed.join('\n');
  }

  /**
   * Parse hunks from a unified diff
   */
  private parseHunks(patch: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const lines = patch.split('\n');
    let currentHunk: DiffHunk | null = null;

    for (const line of lines) {
      const hunkMatch = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldLines: parseInt(hunkMatch[2] || '1', 10),
          newStart: parseInt(hunkMatch[3], 10),
          newLines: parseInt(hunkMatch[4] || '1', 10),
          lines: [],
        };
      } else if (currentHunk && !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('Index:') && !line.startsWith('===')) {
        currentHunk.lines.push(line);
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  /**
   * Count added and deleted lines in a diff
   */
  private countChanges(patch: string): { linesAdded: number; linesDeleted: number } {
    let linesAdded = 0;
    let linesDeleted = 0;

    const lines = patch.split('\n');
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
   * Get context lines around a change
   */
  extractContext(
    content: string,
    lineNumber: number,
    contextSize: number = 5
  ): string[] {
    const lines = content.split('\n');
    const start = Math.max(0, lineNumber - contextSize);
    const end = Math.min(lines.length, lineNumber + contextSize + 1);
    return lines.slice(start, end);
  }

  /**
   * Calculate similarity between two strings (0-1)
   */
  calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) {return 1;}
    if (str1.length === 0 || str2.length === 0) {return 0;}

    const changes = Diff.diffChars(str1, str2);
    let commonLength = 0;
    
    for (const change of changes) {
      if (!change.added && !change.removed) {
        commonLength += change.value.length;
      }
    }

    const totalLength = Math.max(str1.length, str2.length);
    return commonLength / totalLength;
  }

  /**
   * Format diff for display with syntax highlighting hints
   */
  formatDiffForDisplay(diff: string): string {
    const lines = diff.split('\n');
    const formatted: string[] = [];

    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        formatted.push(`[header]${line}[/header]`);
      } else if (line.startsWith('@@')) {
        formatted.push(`[hunk]${line}[/hunk]`);
      } else if (line.startsWith('+')) {
        formatted.push(`[added]${line}[/added]`);
      } else if (line.startsWith('-')) {
        formatted.push(`[removed]${line}[/removed]`);
      } else {
        formatted.push(`[context]${line}[/context]`);
      }
    }

    return formatted.join('\n');
  }

  /**
   * Get summary statistics for a diff
   */
  getDiffStats(diff: string): {
    linesAdded: number;
    linesDeleted: number;
    linesModified: number;
    hunksCount: number;
  } {
    const { linesAdded, linesDeleted } = this.countChanges(diff);
    const hunks = this.parseHunks(diff);

    return {
      linesAdded,
      linesDeleted,
      linesModified: Math.min(linesAdded, linesDeleted),
      hunksCount: hunks.length,
    };
  }
}

// Export singleton instance
export const diffService = new DiffService();
