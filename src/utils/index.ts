/**
 * Utility functions for Code Historian extension
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { ulid } from 'ulid';
import { minimatch } from 'minimatch';
import { LANGUAGE_EXTENSIONS } from '../constants';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Generate a unique ID using ULID (sortable)
 */
export function generateId(): string {
  return ulid();
}

/**
 * Generate a hash for workspace identification
 */
export function generateWorkspaceId(workspacePath: string): string {
  return crypto.createHash('sha256').update(workspacePath).digest('hex').substring(0, 16);
}

/**
 * Generate a hash for content deduplication
 */
export function generateContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Compress string data using gzip
 */
export async function compressData(data: string): Promise<Buffer> {
  return gzip(Buffer.from(data, 'utf-8'));
}

/**
 * Decompress gzip data to string
 */
export async function decompressData(data: Buffer): Promise<string> {
  const decompressed = await gunzip(data);
  return decompressed.toString('utf-8');
}

/**
 * Get language from file path
 */
export function getLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_EXTENSIONS[ext] || 'plaintext';
}

/**
 * Get file extension from path
 */
export function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * Check if a file path matches any of the patterns
 */
export function matchesPatterns(filePath: string, patterns: string[]): boolean {
  return patterns.some(pattern => minimatch(filePath, pattern, { dot: true }));
}

/**
 * Normalize file path for consistent storage
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Get relative path from workspace root
 */
export function getRelativePath(absolutePath: string, workspaceRoot: string): string {
  const normalized = normalizePath(absolutePath);
  const normalizedRoot = normalizePath(workspaceRoot);

  if (normalized.startsWith(normalizedRoot)) {
    return normalized.substring(normalizedRoot.length + 1);
  }
  return normalized;
}

/**
 * Format timestamp to readable date string
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Format timestamp to relative time string
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (seconds < 60) {
    return 'just now';
  } else if (minutes < 60) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else if (hours < 24) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (days < 7) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (weeks < 4) {
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  } else {
    return `${months} month${months > 1 ? 's' : ''} ago`;
  }
}

/**
 * Truncate text to specified length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Split text into chunks for embedding
 */
export function chunkText(text: string, maxTokens: number, overlap: number = 50): string[] {
  // Approximate: 1 token ≈ 4 characters
  const maxChars = maxTokens * 4;
  const overlapChars = overlap * 4;

  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;

    // Try to break at a natural boundary (newline or period)
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end);
      const lastPeriod = text.lastIndexOf('.', end);
      const breakPoint = Math.max(lastNewline, lastPeriod);

      if (breakPoint > start + maxChars / 2) {
        end = breakPoint + 1;
      }
    }

    chunks.push(text.substring(start, Math.min(end, text.length)));
    start = end - overlapChars;
  }

  return chunks;
}

/**
 * Extract context lines around a change
 */
export function extractContextLines(
  content: string,
  changeStart: number,
  changeEnd: number,
  contextSize: number = 5
): string[] {
  const lines = content.split('\n');
  const startLine = Math.max(0, changeStart - contextSize);
  const endLine = Math.min(lines.length, changeEnd + contextSize);

  return lines.slice(startLine, endLine);
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0-1)
 */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);

  return 1 - distance / maxLength;
}

/**
 * Debounce function calls
 */
export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

/**
 * Throttle function calls
 */
export function throttle<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Batch array into chunks
 */
export function batchArray<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Safe JSON parse with default value
 */
export function safeJsonParse<T>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return defaultValue;
  }
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if a value is defined (not null or undefined)
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Get environment variable with default
 */
export function getEnvVar(name: string, defaultValue: string = ''): string {
  return process.env[name] || defaultValue;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Calculate storage directory path
 */
export function getStoragePath(workspaceRoot: string, customPath?: string): string {
  if (customPath) {
    return customPath;
  }
  return path.join(workspaceRoot, '.code-historian');
}

/**
 * Create searchable text from change record
 */
export function createSearchableText(
  filePath: string,
  diff: string,
  symbols: string[],
  summary?: string
): string {
  const parts: string[] = [
    `file: ${path.basename(filePath)}`,
    `path: ${filePath}`,
    symbols.length > 0 ? `symbols: ${symbols.join(', ')}` : '',
    summary ? `summary: ${summary}` : '',
    diff,
  ];

  return parts.filter(Boolean).join('\n');
}

/**
 * Parse a natural language time expression
 */
export function parseTimeExpression(expr: string): { start: number; end: number } | null {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const week = 7 * day;
  const month = 30 * day;

  const patterns: [RegExp, (match: RegExpMatchArray) => { start: number; end: number }][] = [
    [/today/i, () => ({ start: now - day, end: now })],
    [/yesterday/i, () => ({ start: now - 2 * day, end: now - day })],
    [/this\s*week/i, () => ({ start: now - week, end: now })],
    [/last\s*week/i, () => ({ start: now - 2 * week, end: now - week })],
    [/this\s*month/i, () => ({ start: now - month, end: now })],
    [/last\s*month/i, () => ({ start: now - 2 * month, end: now - month })],
    [
      /(\d+)\s*hours?\s*ago/i,
      (match: RegExpMatchArray) => {
        const hours = parseInt(match[1], 10);
        return { start: now - hours * 60 * 60 * 1000, end: now };
      },
    ],
    [
      /(\d+)\s*days?\s*ago/i,
      (match: RegExpMatchArray) => {
        const days = parseInt(match[1], 10);
        return { start: now - days * day, end: now };
      },
    ],
    [
      /(\d+)\s*weeks?\s*ago/i,
      (match: RegExpMatchArray) => {
        const weeks = parseInt(match[1], 10);
        return { start: now - weeks * week, end: now };
      },
    ],
  ];

  for (const [pattern, handler] of patterns) {
    const match = expr.match(pattern);
    if (match) {
      return handler(match);
    }
  }

  return null;
}

/**
 * Extract file patterns from natural language
 */
export function extractFilePatterns(query: string): string[] {
  const patterns: string[] = [];

  // Match explicit file patterns
  const fileMatch = query.match(/(?:in|from|file[s]?)\s+([^\s,]+(?:\.[a-z]+)?)/gi);
  if (fileMatch) {
    fileMatch.forEach(m => {
      const parts = m.split(/\s+/);
      if (parts.length > 1) {
        patterns.push(`**/${parts[parts.length - 1]}*`);
      }
    });
  }

  // Match language keywords
  const languageKeywords: Record<string, string> = {
    typescript: '**/*.ts',
    javascript: '**/*.js',
    python: '**/*.py',
    java: '**/*.java',
    rust: '**/*.rs',
    go: '**/*.go',
    ruby: '**/*.rb',
    php: '**/*.php',
    css: '**/*.css',
    html: '**/*.html',
  };

  for (const [keyword, pattern] of Object.entries(languageKeywords)) {
    if (query.toLowerCase().includes(keyword)) {
      patterns.push(pattern);
    }
  }

  return [...new Set(patterns)];
}
