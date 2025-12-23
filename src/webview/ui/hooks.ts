/**
 * Webview UI Hooks
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { vscode } from './vscode-api';
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  TimelineData,
  StatusData,
  SettingsData,
  SearchResultsData,
  ToastData,
} from '../types';

/**
 * Hook for VS Code messaging
 */
export function useVsCodeMessage<T extends ExtensionToWebviewMessage['type']>(
  type: T,
  handler: (data: Extract<ExtensionToWebviewMessage, { type: T }>['data']) => void
): void {
  useEffect(() => {
    const messageHandler = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      if (event.data.type === type) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handler(event.data.data as any);
      }
    };

    window.addEventListener('message', messageHandler);
    return () => window.removeEventListener('message', messageHandler);
  }, [type, handler]);
}

/**
 * Hook for sending messages to extension
 */
export function useSendMessage(): (message: WebviewToExtensionMessage) => void {
  return useCallback((message: WebviewToExtensionMessage) => {
    console.log('useSendMessage: Sending message to extension:', message.type, message);
    vscode.postMessage(message);
  }, []);
}

/**
 * Hook for timeline data
 */
export function useTimeline() {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sendMessage = useSendMessage();

  useVsCodeMessage('timeline', setData);
  useVsCodeMessage('loading', d => setLoading(d.loading));
  useVsCodeMessage('error', d => setError(d.message));

  const refresh = useCallback(() => {
    setLoading(true);
    sendMessage({ type: 'getTimeline', data: {} });
  }, [sendMessage]);

  const loadMore = useCallback(() => {
    if (data && data.hasMore) {
      sendMessage({
        type: 'getTimeline',
        data: { page: data.page + 1, pageSize: data.pageSize },
      });
    }
  }, [data, sendMessage]);

  const filter = useCallback(
    (
      filters: Parameters<typeof sendMessage>[0] extends { type: 'getTimeline' }
        ? Parameters<typeof sendMessage>[0]['data']
        : never
    ) => {
      setLoading(true);
      sendMessage({ type: 'getTimeline', data: filters });
    },
    [sendMessage]
  );

  useEffect(() => {
    // Signal ready and request initial data
    sendMessage({ type: 'ready' });
    refresh();
  }, []);

  return { data, loading, error, refresh, loadMore, filter };
}

/**
 * Hook for status data
 */
export function useStatus() {
  const [status, setStatus] = useState<StatusData | null>(null);
  useVsCodeMessage('status', setStatus);
  return status;
}

/**
 * Hook for settings
 */
export function useSettings() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const sendMessage = useSendMessage();

  useVsCodeMessage('settings', newSettings => {
    setSettings(newSettings);
    setSaving(false); // Reset saving state when we receive confirmed settings
  });

  const updateSettings = useCallback(
    (updates: Partial<SettingsData>) => {
      setSaving(true);
      sendMessage({ type: 'updateSettings', data: updates });
      // Don't do optimistic update - wait for confirmation from extension
    },
    [sendMessage]
  );

  const loadSettings = useCallback(() => {
    sendMessage({ type: 'getSettings' });
  }, [sendMessage]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return { settings, saving, updateSettings, loadSettings };
}

/**
 * Hook for search
 */
export function useSearch() {
  const [results, setResults] = useState<SearchResultsData | null>(null);
  const [loading, setLoading] = useState(false);
  const sendMessage = useSendMessage();

  useVsCodeMessage('searchResults', data => {
    setResults(data);
    setLoading(false);
  });

  const search = useCallback(
    (query: string, filters?: Record<string, unknown>) => {
      if (!query.trim()) {
        setResults(null);
        return;
      }
      setLoading(true);
      sendMessage({ type: 'search', data: { query, filters: filters as any } });
    },
    [sendMessage]
  );

  const clear = useCallback(() => {
    setResults(null);
  }, []);

  return { results, loading, search, clear };
}

/**
 * Hook for toast notifications
 */
export function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  useVsCodeMessage('toast', toast => {
    setToasts(prev => [...prev, toast]);

    // Auto-dismiss
    if (toast.duration !== 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, toast.duration || 5000);
    }
  });

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, dismiss };
}

/**
 * Hook for debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook for local storage with VS Code state
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const state = vscode.getState<Record<string, T>>();
    return state?.[key] ?? defaultValue;
  });

  const setPersistedValue = useCallback(
    (newValue: T) => {
      setValue(newValue);
      const state = vscode.getState<Record<string, T>>() || {};
      vscode.setState({ ...state, [key]: newValue });
    },
    [key]
  );

  return [value, setPersistedValue];
}

/**
 * Hook for intersection observer (infinite scroll)
 */
export function useIntersectionObserver(callback: () => void, options?: IntersectionObserverInit) {
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          callback();
        }
      },
      { threshold: 0.1, ...options }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [callback, options]);

  return targetRef;
}

/**
 * Hook for keyboard shortcuts
 */
export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean }
): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const matchesKey = event.key.toLowerCase() === key.toLowerCase();
      const matchesCtrl = modifiers?.ctrl ? event.ctrlKey || event.metaKey : true;
      const matchesShift = modifiers?.shift ? event.shiftKey : true;
      const matchesAlt = modifiers?.alt ? event.altKey : true;

      if (matchesKey && matchesCtrl && matchesShift && matchesAlt) {
        event.preventDefault();
        callback();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [key, callback, modifiers]);
}
