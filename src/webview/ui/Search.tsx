/**
 * Search Component
 * Search bar with filters and results display
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { SearchResultsData, SearchResult, SearchRequest } from '../types';
import { Button, Input, Badge, Card, Select, Spinner, EmptyState } from './components';
import { useDebounce } from './hooks';
import { vscode } from './vscode-api';

interface SearchProps {
  results: SearchResultsData | null;
  loading: boolean;
  onSearch: (query: string, filters?: SearchRequest['filters']) => void;
  onClear: () => void;
}

export const Search: React.FC<SearchProps> = ({ results, loading, onSearch, onClear }) => {
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<SearchRequest['filters']>({});

  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedQuery) {
      onSearch(debouncedQuery, filters);
    }
  }, [debouncedQuery, filters, onSearch]);

  const handleClear = useCallback(() => {
    setQuery('');
    setFilters({});
    onClear();
  }, [onClear]);

  const handleResultClick = useCallback((result: SearchResult) => {
    vscode.postMessage({
      type: 'getChangeDetails',
      data: { changeId: result.change.id },
    });
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Search header */}
      <div className="p-3 border-b border-[var(--vscode-panel-border)] space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search your code history..."
            leftIcon={<i className="codicon codicon-search" />}
            rightElement={
              loading ? (
                <Spinner size="sm" />
              ) : query ? (
                <button onClick={handleClear} className="hover:opacity-80" title="Clear search">
                  <i className="codicon codicon-close" />
                </button>
              ) : null
            }
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowFilters(!showFilters)}
            className={showFilters ? 'bg-[var(--vscode-list-hoverBackground)]' : ''}
          >
            <i className="codicon codicon-filter" />
          </Button>
        </div>

        {/* Filters */}
        {showFilters && <SearchFilters filters={filters} onChange={setFilters} />}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!query && !results && (
          <EmptyState
            icon="search"
            title="Search your code history"
            description="Find changes by content, file name, symbols, or natural language queries."
          />
        )}

        {query && !results && loading && (
          <div className="flex items-center justify-center h-full">
            <Spinner size="lg" />
          </div>
        )}

        {results && results.results.length === 0 && (
          <EmptyState
            icon="search-stop"
            title="No results found"
            description={`No changes match "${results.query}". Try different keywords or filters.`}
            action={
              <Button variant="secondary" size="sm" onClick={handleClear}>
                Clear Search
              </Button>
            }
          />
        )}

        {results && results.results.length > 0 && (
          <div>
            {/* Results summary */}
            <div className="px-3 py-2 text-xs text-[var(--vscode-descriptionForeground)] border-b border-[var(--vscode-panel-border)]">
              Found {results.total} results in {results.executionTime}ms
            </div>

            {/* Results list */}
            <div className="divide-y divide-[var(--vscode-panel-border)]">
              {results.results.map(result => (
                <SearchResultItem
                  key={result.change.id}
                  result={result}
                  onClick={() => handleResultClick(result)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Search filters component
interface SearchFiltersProps {
  filters: SearchRequest['filters'];
  onChange: (filters: SearchRequest['filters']) => void;
}

const SearchFilters: React.FC<SearchFiltersProps> = ({ filters = {}, onChange }) => {
  const updateFilter = useCallback(
    (key: keyof NonNullable<SearchRequest['filters']>, value: unknown) => {
      onChange({
        ...filters,
        [key]: value === '' ? undefined : value,
      });
    },
    [filters, onChange]
  );

  return (
    <div className="space-y-3 p-2 bg-[var(--vscode-editor-background)] rounded border border-[var(--vscode-panel-border)]">
      <div className="grid grid-cols-2 gap-2">
        {/* Date range */}
        <div>
          <label className="block text-xs text-[var(--vscode-descriptionForeground)] mb-1">
            From Date
          </label>
          <Input
            type="date"
            value={filters?.dateFrom ? new Date(filters.dateFrom).toISOString().split('T')[0] : ''}
            onChange={e =>
              updateFilter(
                'dateFrom',
                e.target.value ? new Date(e.target.value).getTime() : undefined
              )
            }
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--vscode-descriptionForeground)] mb-1">
            To Date
          </label>
          <Input
            type="date"
            value={filters?.dateTo ? new Date(filters.dateTo).toISOString().split('T')[0] : ''}
            onChange={e =>
              updateFilter(
                'dateTo',
                e.target.value ? new Date(e.target.value).getTime() : undefined
              )
            }
          />
        </div>
      </div>

      {/* Language filter */}
      <div>
        <label className="block text-xs text-[var(--vscode-descriptionForeground)] mb-1">
          Languages
        </label>
        <Input
          value={filters?.languages?.join(', ') || ''}
          onChange={e =>
            updateFilter(
              'languages',
              e.target.value ? e.target.value.split(',').map(s => s.trim()) : undefined
            )
          }
          placeholder="typescript, python, ..."
        />
      </div>

      {/* Change types */}
      <div>
        <label className="block text-xs text-[var(--vscode-descriptionForeground)] mb-1">
          Change Types
        </label>
        <div className="flex flex-wrap gap-1">
          {['create', 'modify', 'delete', 'rename'].map(type => {
            const isSelected = filters?.changeTypes?.includes(type);
            return (
              <button
                key={type}
                onClick={() => {
                  const current = filters?.changeTypes || [];
                  const updated = isSelected ? current.filter(t => t !== type) : [...current, type];
                  updateFilter('changeTypes', updated.length > 0 ? updated : undefined);
                }}
                className={`
                  px-2 py-1 text-xs rounded
                  ${
                    isSelected
                      ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]'
                      : 'bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)]'
                  }
                `}
              >
                {type}
              </button>
            );
          })}
        </div>
      </div>

      {/* Clear filters */}
      <Button variant="ghost" size="sm" onClick={() => onChange({})} className="w-full">
        Clear Filters
      </Button>
    </div>
  );
};

// Individual search result
interface SearchResultItemProps {
  result: SearchResult;
  onClick: () => void;
}

const SearchResultItem: React.FC<SearchResultItemProps> = ({ result, onClick }) => {
  const { change, score, highlights, snippet } = result;

  const typeColors: Record<string, string> = {
    create: 'var(--vscode-testing-iconPassed)',
    modify: 'var(--vscode-debugIcon-startForeground)',
    delete: 'var(--vscode-testing-iconFailed)',
    rename: 'var(--vscode-debugIcon-restartForeground)',
  };

  return (
    <div
      onClick={onClick}
      className="px-3 py-3 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: typeColors[change.changeType] }}
          />
          <span className="font-medium text-sm text-[var(--vscode-foreground)] truncate">
            {change.fileName}
          </span>
        </div>
        <Badge variant="default" className="flex-shrink-0">
          {Math.round(score * 100)}%
        </Badge>
      </div>

      {/* Path */}
      <p className="text-xs text-[var(--vscode-descriptionForeground)] truncate mt-1">
        {change.filePath}
      </p>

      {/* Snippet */}
      {snippet && (
        <div className="mt-2 text-xs font-mono p-2 rounded bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] overflow-x-auto">
          <HighlightedText text={snippet} />
        </div>
      )}

      {/* Highlights */}
      {highlights.length > 0 && !snippet && (
        <div className="mt-2 flex flex-wrap gap-1">
          {highlights.map((h, i) => (
            <span
              key={i}
              className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--vscode-editor-findMatchHighlightBackground)] text-[var(--vscode-foreground)]"
            >
              {h.field}: {h.matches.slice(0, 2).join(', ')}
              {h.matches.length > 2 && ` +${h.matches.length - 2}`}
            </span>
          ))}
        </div>
      )}

      {/* Metadata */}
      <div className="flex items-center gap-3 mt-2 text-xs text-[var(--vscode-descriptionForeground)]">
        <span>{formatRelativeTime(change.timestamp)}</span>
        {change.language && <Badge variant="default">{change.language}</Badge>}
        {change.linesAdded > 0 && <span className="text-green-500">+{change.linesAdded}</span>}
        {change.linesRemoved > 0 && <span className="text-red-500">-{change.linesRemoved}</span>}
      </div>
    </div>
  );
};

// Highlighted text component
const HighlightedText: React.FC<{ text: string }> = ({ text }) => {
  // Simple highlight for matching parts (assuming they're wrapped in <mark>)
  const parts = text.split(/(<mark>.*?<\/mark>)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('<mark>') && part.endsWith('</mark>')) {
          const content = part.slice(6, -7);
          return (
            <span
              key={i}
              className="bg-[var(--vscode-editor-findMatchHighlightBackground)] px-0.5 rounded"
            >
              {content}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
};

// Utility
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
