/**
 * Main Webview App
 * Root component for the sidebar webview with modern chat UI
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Timeline } from './Timeline';
import { Search } from './Search';
import { SettingsPanel } from './SettingsPanel';
import { StatusBar } from './StatusBar';
import { Tabs, Spinner } from './components';
import {
  useTimeline,
  useSearch,
  useSettings,
  useStatus,
  useToast,
  useKeyboardShortcut,
  useSendMessage,
} from './hooks';
import { vscode } from './vscode-api';
import type { ToastData, TimelineRequest, ChatResponseData } from '../types';

type View = 'chat' | 'timeline' | 'search' | 'settings';

// Chat message types
interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sources?: Array<{
    changeId: string;
    filePath: string;
    timestamp: number;
    summary?: string;
  }>;
  isStreaming?: boolean;
}

const App: React.FC = () => {
  const [activeView, setActiveView] = useState<View>('timeline');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Data hooks
  const { data: timelineData, loading: timelineLoading, refresh, loadMore, filter } = useTimeline();
  const {
    results: searchResults,
    loading: searchLoading,
    search,
    clear: clearSearch,
  } = useSearch();
  const { settings, updateSettings, loadSettings } = useSettings();
  const status = useStatus();
  const { toasts, dismiss } = useToast();
  const sendMessage = useSendMessage();

  const hasChatHistory = chatMessages.length > 0;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Listen for chat responses
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'chatResponse') {
        const data = message.data as ChatResponseData;
        const messageId = `assistant-${Date.now()}`;

        if (data.isStreaming) {
          setIsStreaming(true);
          setStreamingMessageId(messageId);
          setChatMessages(prev => [
            ...prev,
            {
              id: messageId,
              type: 'assistant',
              content: '',
              timestamp: Date.now(),
              sources: data.sources,
              isStreaming: true,
            },
          ]);
        } else {
          setIsStreaming(false);
          setStreamingMessageId(null);
          setChatMessages(prev => [
            ...prev,
            {
              id: messageId,
              type: 'assistant',
              content: data.response,
              timestamp: Date.now(),
              sources: data.sources,
            },
          ]);
        }
      } else if (message.type === 'chatResponseChunk') {
        setChatMessages(prev =>
          prev.map(msg =>
            msg.id === streamingMessageId
              ? { ...msg, content: msg.content + message.data.chunk }
              : msg
          )
        );
      } else if (message.type === 'chatResponseEnd') {
        setIsStreaming(false);
        setChatMessages(prev =>
          prev.map(msg => (msg.id === streamingMessageId ? { ...msg, isStreaming: false } : msg))
        );
        setStreamingMessageId(null);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [streamingMessageId]);

  // Keyboard shortcuts
  useKeyboardShortcut('f', () => setActiveView('search'), { ctrl: true });
  useKeyboardShortcut('r', () => refresh(), { ctrl: true, shift: true });

  // Handle tab change
  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveView(tab as View);
      if (tab === 'settings') {
        loadSettings();
      }
    },
    [loadSettings]
  );

  // Handle chat message submission
  const handleChatSubmit = useCallback(
    (query: string) => {
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        type: 'user',
        content: query,
        timestamp: Date.now(),
      };
      setChatMessages(prev => [...prev, userMessage]);
      setIsStreaming(true);
      setActiveView('chat'); // Switch to chat view when sending a message
      sendMessage({ type: 'chat', data: { message: query } });
    },
    [sendMessage]
  );

  // Start new chat
  const handleNewChat = useCallback(() => {
    setChatMessages([]);
    setIsStreaming(false);
    setStreamingMessageId(null);
    setActiveView('timeline');
  }, []);

  // Build tabs dynamically - include Chat tab when there's history
  const tabs = [
    ...(hasChatHistory
      ? [{ id: 'chat', label: `Chat (${chatMessages.length})`, icon: 'comment' }]
      : []),
    { id: 'timeline', label: 'Timeline', icon: 'history' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'settings', label: 'Settings', icon: 'gear' },
  ];

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="header-logo">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <polyline
                points="12,6 12,12 16,14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="header-text">
            <h1 className="header-title">Code Historian</h1>
            <span className="header-subtitle">
              {status?.stats?.totalChanges ?? 0} changes tracked
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button className="header-action-btn" onClick={() => refresh()} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.451 5.609l-.579-.939-1.068.812-.076.094c-.335.415-.927 1.341-.927 2.619 0 2.04-1.759 3.699-3.801 3.699-2.042 0-3.801-1.659-3.801-3.699 0-1.907 1.474-3.487 3.401-3.674v1.627l3.4-2.299-3.4-2.299v1.568c-2.637.194-4.801 2.39-4.801 5.077 0 2.812 2.381 5.1 5.201 5.1s5.201-2.288 5.201-5.1c0-1.049-.342-2.063-.927-2.88l.177-.106z" />
            </svg>
          </button>
        </div>
      </header>

      <StatusBar status={status} />

      <Tabs tabs={tabs} activeTab={activeView} onChange={handleTabChange} />

      {/* Main content */}
      <div className="main-content">
        {/* Chat view */}
        {activeView === 'chat' && hasChatHistory && (
          <div className="chat-container">
            <div className="chat-header">
              <div className="chat-header-left">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 3a3 3 0 00-3 3v4a3 3 0 003 3h1v2l3-2h2a3 3 0 003-3V6a3 3 0 00-3-3H5zm0 1h6a2 2 0 012 2v4a2 2 0 01-2 2H8.5l-2 1.333V12H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
                </svg>
                <span>Chat</span>
                <span className="chat-badge">{chatMessages.length}</span>
              </div>
              <button className="new-chat-btn" onClick={handleNewChat} title="New Chat">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1v6H2v1h6v6h1V8h6V7H9V1H8z" />
                </svg>
                <span>New</span>
              </button>
            </div>

            <div className="chat-messages" ref={chatContainerRef}>
              {chatMessages.map(msg => (
                <ChatMessageBubble key={msg.id} message={msg} />
              ))}
              {isStreaming && !streamingMessageId && (
                <div className="chat-typing">
                  <div className="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab content - shown based on active tab */}
        {activeView === 'timeline' && (
          <Timeline
            data={timelineData}
            loading={timelineLoading}
            onFilter={filter as (filters: TimelineRequest) => void}
            onLoadMore={loadMore}
          />
        )}
        {activeView === 'search' && (
          <Search
            results={searchResults}
            loading={searchLoading}
            onSearch={search}
            onClear={clearSearch}
          />
        )}
        {activeView === 'settings' && settings && (
          <SettingsPanel settings={settings} onUpdate={updateSettings} />
        )}
      </div>

      <ChatInput onSubmit={handleChatSubmit} isLoading={isStreaming} />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
};

// Simple Markdown Renderer
interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const renderLine = (line: string, index: number): JSX.Element => {
    // Headers
    if (line.startsWith('### ')) {
      return (
        <h4 key={index} className="md-h4">
          {renderInline(line.slice(4))}
        </h4>
      );
    }
    if (line.startsWith('## ')) {
      return (
        <h3 key={index} className="md-h3">
          {renderInline(line.slice(3))}
        </h3>
      );
    }
    if (line.startsWith('# ')) {
      return (
        <h2 key={index} className="md-h2">
          {renderInline(line.slice(2))}
        </h2>
      );
    }

    // Numbered lists (1. 2. 3. etc)
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      return (
        <div key={index} className="md-list-item md-list-numbered">
          <span className="md-list-num">{numberedMatch[1]}.</span>
          <span>{renderInline(numberedMatch[2])}</span>
        </div>
      );
    }

    // Bullet lists
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <div key={index} className="md-list-item">
          <span className="md-bullet">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    }

    // Empty line
    if (!line.trim()) {
      return <div key={index} className="md-spacer" />;
    }

    // Regular paragraph
    return (
      <p key={index} className="md-p">
        {renderInline(line)}
      </p>
    );
  };

  const renderInline = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let keyIndex = 0;

    while (remaining.length > 0) {
      // Code inline `code`
      const codeMatch = remaining.match(/^`([^`]+)`/);
      if (codeMatch) {
        parts.push(
          <code key={keyIndex++} className="md-code">
            {codeMatch[1]}
          </code>
        );
        remaining = remaining.slice(codeMatch[0].length);
        continue;
      }

      // Bold **text** or __text__
      const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/) || remaining.match(/^__([^_]+)__/);
      if (boldMatch) {
        parts.push(
          <strong key={keyIndex++} className="md-bold">
            {boldMatch[1]}
          </strong>
        );
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }

      // Italic *text* or _text_
      const italicMatch = remaining.match(/^\*([^*]+)\*/) || remaining.match(/^_([^_]+)_/);
      if (italicMatch) {
        parts.push(
          <em key={keyIndex++} className="md-italic">
            {italicMatch[1]}
          </em>
        );
        remaining = remaining.slice(italicMatch[0].length);
        continue;
      }

      // Regular text - find next special character or end
      const nextSpecial = remaining.search(/[`*_]/);
      if (nextSpecial === -1) {
        parts.push(remaining);
        break;
      } else if (nextSpecial === 0) {
        // Special char that didn't match a pattern, treat as regular text
        parts.push(remaining[0]);
        remaining = remaining.slice(1);
      } else {
        parts.push(remaining.slice(0, nextSpecial));
        remaining = remaining.slice(nextSpecial);
      }
    }

    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  const lines = content.split('\n');
  return <div className="md-content">{lines.map(renderLine)}</div>;
};

// Chat Message Bubble
interface ChatMessageBubbleProps {
  message: ChatMessage;
}

const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({ message }) => {
  const isUser = message.type === 'user';
  const [showSources, setShowSources] = useState(false);

  return (
    <div className={`chat-msg ${isUser ? 'chat-msg--user' : 'chat-msg--assistant'}`}>
      <div className="chat-msg-avatar">
        {isUser ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm0 1c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM2 8a6 6 0 1112 0A6 6 0 012 8z" />
            <path d="M8 3.5a.5.5 0 01.5.5v4l3 1.5a.5.5 0 01-.5.9l-3.25-1.62A.5.5 0 017.5 8.5V4a.5.5 0 01.5-.5z" />
          </svg>
        )}
      </div>
      <div className="chat-msg-body">
        <div className="chat-msg-meta">
          <span className="chat-msg-role">{isUser ? 'You' : 'Code Historian'}</span>
          <span className="chat-msg-time">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
        <div className="chat-msg-content">
          {message.content ? (
            <MarkdownRenderer content={message.content} />
          ) : message.isStreaming ? (
            <span className="cursor-blink">▌</span>
          ) : null}
        </div>

        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="chat-sources">
            <button className="sources-toggle" onClick={() => setShowSources(!showSources)}>
              <svg
                width="10"
                height="10"
                viewBox="0 0 16 16"
                fill="currentColor"
                style={{
                  transform: showSources ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }}
              >
                <path d="M6 12l4-4-4-4v8z" />
              </svg>
              <span>Sources ({message.sources.length})</span>
            </button>

            {showSources && (
              <div className="sources-grid">
                {message.sources.map((source, i) => (
                  <button
                    key={i}
                    className="source-item"
                    onClick={() =>
                      vscode.postMessage({
                        type: 'getChangeDetails',
                        data: { changeId: source.changeId },
                      })
                    }
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M14.5 3H7.71l-.85-.85L6.5 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.5 10H2V3h4.29l.86.85.35.15H14v9z" />
                    </svg>
                    <span className="source-name">{source.filePath.split('/').pop()}</span>
                    <span className="source-date">
                      {new Date(source.timestamp).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Chat Input
interface ChatInputProps {
  onSubmit: (query: string) => void;
  isLoading?: boolean;
}

const ChatInput: React.FC<ChatInputProps> = ({ onSubmit, isLoading = false }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query.trim() && !isLoading) {
        onSubmit(query.trim());
        setQuery('');
      }
    },
    [query, onSubmit, isLoading]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit]
  );

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 100) + 'px';
    }
  }, [query]);

  const suggestions = ['What changed recently?', 'Show bug fixes today', 'Changes to auth logic'];

  return (
    <div className="chat-input-area">
      <div className="suggestion-row">
        {suggestions.map((s, i) => (
          <button
            key={i}
            className="suggestion-btn"
            onClick={() => !isLoading && setQuery(s)}
            disabled={isLoading}
          >
            {s}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="input-form">
        <div className="input-row">
          <textarea
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your code history..."
            className="chat-textarea"
            disabled={isLoading}
            rows={1}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={!query.trim() || isLoading}
            title="Send"
          >
            {isLoading ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="spin-icon"
              >
                <path
                  d="M8 1a7 7 0 11-7 7 7 7 0 017-7m0-1a8 8 0 100 16A8 8 0 008 0z"
                  opacity="0.3"
                />
                <path d="M8 0v1a7 7 0 017 7h1A8 8 0 008 0z" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.724 1.053a.5.5 0 00-.714.545l1.403 4.85a.5.5 0 00.397.354l5.69.953c.268.053.268.442 0 .495l-5.69.953a.5.5 0 00-.397.354l-1.403 4.85a.5.5 0 00.714.545l13-6.5a.5.5 0 000-.894l-13-6.5z" />
              </svg>
            )}
          </button>
        </div>
      </form>
      <div className="input-hint">
        <span>Enter to send · Shift+Enter for new line</span>
      </div>
    </div>
  );
};

// Toast Container
interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast--${toast.type}`}>
          <span className="toast-msg">{toast.message}</span>
          <button className="toast-close" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

// Mount
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
