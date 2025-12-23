/**
 * Logger utility for Code Historian extension
 */

import * as vscode from 'vscode';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private outputChannel: vscode.OutputChannel | null = null;
  private logLevel: LogLevel = LogLevel.INFO;

  initialize(outputChannel: vscode.OutputChannel): void {
    this.outputChannel = outputChannel;
  }

  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, error?: Error, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...args);
    if (error) {
      this.log(LogLevel.ERROR, `Stack: ${error.stack}`);
    }
  }

  private formatArg(arg: unknown): string {
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
    }
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level < this.logLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelStr = LogLevel[level].padEnd(5);
    const formattedMessage =
      args.length > 0 ? `${message} ${args.map(a => this.formatArg(a)).join(' ')}` : message;

    const logLine = `[${timestamp}] [${levelStr}] ${formattedMessage}`;

    if (this.outputChannel) {
      this.outputChannel.appendLine(logLine);
    }

    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(logLine);
          break;
        case LogLevel.INFO:
          console.info(logLine);
          break;
        case LogLevel.WARN:
          console.warn(logLine);
          break;
        case LogLevel.ERROR:
          console.error(logLine);
          break;
      }
    }
  }

  show(): void {
    this.outputChannel?.show();
  }

  clear(): void {
    this.outputChannel?.clear();
  }
}

// Singleton instance
export const logger = new Logger();
