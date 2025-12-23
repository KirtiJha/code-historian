/**
 * Event emitter for extension-wide events
 */

import * as vscode from 'vscode';
import type { ChangeRecord, Session, SearchResult, RestoreResult, ExtensionConfig } from '../types';
import { EVENTS } from '../constants';

type EventCallback<T> = (data: T) => void;

interface EventMap {
  [EVENTS.CHANGE_CAPTURED]: ChangeRecord;
  [EVENTS.SESSION_STARTED]: Session;
  [EVENTS.SESSION_ENDED]: Session;
  [EVENTS.SEARCH_COMPLETED]: SearchResult[];
  [EVENTS.RESTORE_COMPLETED]: RestoreResult;
  [EVENTS.CONFIG_CHANGED]: Partial<ExtensionConfig>;
  [EVENTS.ERROR_OCCURRED]: { error: Error; context: string };
  [EVENTS.EMBEDDING_COMPLETED]: { changeId: string; embeddingId: string };
  [EVENTS.INDEX_UPDATED]: { count: number; duration: number };
}

class EventEmitter {
  private listeners: Map<string, Set<EventCallback<unknown>>> = new Map();
  private outputChannel: vscode.OutputChannel | null = null;

  setOutputChannel(channel: vscode.OutputChannel): void {
    this.outputChannel = channel;
  }

  on<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): vscode.Disposable {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback<unknown>);

    return new vscode.Disposable(() => {
      this.off(event, callback);
    });
  }

  off<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(callback as EventCallback<unknown>);
    }
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          this.log(`Error in event listener for ${event}: ${error}`);
        }
      });
    }
  }

  once<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): vscode.Disposable {
    const wrappedCallback: EventCallback<EventMap[K]> = (data) => {
      this.off(event, wrappedCallback);
      callback(data);
    };
    return this.on(event, wrappedCallback);
  }

  removeAllListeners(event?: keyof EventMap): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  private log(message: string): void {
    if (this.outputChannel) {
      this.outputChannel.appendLine(`[EventEmitter] ${message}`);
    }
  }
}

// Singleton instance
export const eventEmitter = new EventEmitter();
