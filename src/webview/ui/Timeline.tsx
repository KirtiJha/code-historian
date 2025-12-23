/**
 * Timeline Component
 * Visual timeline of code changes with filtering, grouping, and detail view
 * Enhanced with modern UI/UX: multiple view modes, stats dashboard, date filters
 */

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type {
  TimelineData,
  TimelineChange,
  TimelineRequest,
  ChangeDetailsData,
  ExtensionToWebviewMessage,
} from '../types';
import { Button, Input, Badge, Select, EmptyState, Spinner, Tooltip } from './components';
import { useDebounce, useIntersectionObserver } from './hooks';
import { vscode } from './vscode-api';

// View mode types
type ViewMode = 'timeline' | 'compact' | 'cards';
type SortOrder = 'newest' | 'oldest' | 'most-changes';

interface TimelineProps {
  data: TimelineData | null;
  loading: boolean;
  onFilter: (filters: TimelineRequest) => void;
  onLoadMore: () => void;
}

export const Timeline: React.FC<TimelineProps> = ({ data, loading, onFilter, onLoadMore }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<'date' | 'file' | 'none'>('date');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedChange, setSelectedChange] = useState<TimelineChange | null>(null);
  const [changeDetails, setChangeDetails] = useState<ChangeDetailsData | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Enhanced UI state
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [showFilters, setShowFilters] = useState(true);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({
    start: '',
    end: '',
  });
  const [selectedChanges, setSelectedChanges] = useState<Set<string>>(new Set());
  const [expandAll, setExpandAll] = useState(true);

  const debouncedSearch = useDebounce(searchQuery, 300);
  const loadMoreRef = useIntersectionObserver(onLoadMore);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Listen for change details from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      if (event.data.type === 'changeDetails') {
        setChangeDetails(event.data.data);
        setDetailsLoading(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Apply search filter
  useEffect(() => {
    if (debouncedSearch !== undefined) {
      onFilter({ searchQuery: debouncedSearch });
    }
  }, [debouncedSearch, onFilter]);

  // Filter changes by selected types and date range
  const filteredChanges = useMemo(() => {
    if (!data?.changes) return [];

    let filtered = data.changes;

    // Type filter
    if (selectedTypes.length > 0) {
      filtered = filtered.filter(c => selectedTypes.includes(c.changeType));
    }

    // Date range filter
    if (dateRange.start) {
      const startDate = new Date(dateRange.start).getTime();
      filtered = filtered.filter(c => c.timestamp >= startDate);
    }
    if (dateRange.end) {
      const endDate = new Date(dateRange.end).setHours(23, 59, 59, 999);
      filtered = filtered.filter(c => c.timestamp <= endDate);
    }

    return filtered;
  }, [data?.changes, selectedTypes, dateRange]);

  // Sort changes
  const sortedChanges = useMemo(() => {
    const changes = [...filteredChanges];

    switch (sortOrder) {
      case 'oldest':
        return changes.sort((a, b) => a.timestamp - b.timestamp);
      case 'most-changes':
        return changes.sort(
          (a, b) => b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved)
        );
      case 'newest':
      default:
        return changes.sort((a, b) => b.timestamp - a.timestamp);
    }
  }, [filteredChanges, sortOrder]);

  // Group changes
  const groupedChanges = useMemo(() => {
    if (!sortedChanges.length) return {};

    if (groupBy === 'none') {
      return { 'All Changes': sortedChanges };
    }

    return sortedChanges.reduce(
      (acc, change) => {
        let key: string;

        if (groupBy === 'date') {
          key = formatDate(change.timestamp);
        } else if (groupBy === 'file') {
          key = change.filePath.split('/').slice(0, -1).join('/') || 'Root';
        } else {
          key = 'All';
        }

        if (!acc[key]) acc[key] = [];
        acc[key].push(change);
        return acc;
      },
      {} as Record<string, TimelineChange[]>
    );
  }, [sortedChanges, groupBy]);

  // Calculate stats
  const stats = useMemo(() => {
    if (!data?.changes)
      return {
        total: 0,
        created: 0,
        modified: 0,
        deleted: 0,
        linesAdded: 0,
        linesRemoved: 0,
        files: 0,
      };

    const uniqueFiles = new Set(data.changes.map(c => c.filePath));

    return {
      total: data.changes.length,
      created: data.changes.filter(c => c.changeType === 'create').length,
      modified: data.changes.filter(c => c.changeType === 'modify').length,
      deleted: data.changes.filter(c => c.changeType === 'delete').length,
      linesAdded: data.changes.reduce((sum, c) => sum + c.linesAdded, 0),
      linesRemoved: data.changes.reduce((sum, c) => sum + c.linesRemoved, 0),
      files: uniqueFiles.size,
    };
  }, [data?.changes]);

  // Activity heatmap data (last 7 days)
  const heatmapData = useMemo(() => {
    if (!data?.changes) return [];

    const days: { date: string; count: number; label: string }[] = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayStart = new Date(dateStr).getTime();
      const dayEnd = dayStart + 86400000;

      const count = data.changes.filter(
        c => c.timestamp >= dayStart && c.timestamp < dayEnd
      ).length;

      days.push({
        date: dateStr,
        count,
        label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      });
    }

    return days;
  }, [data?.changes]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleExpandAll = useCallback(() => {
    if (expandAll) {
      setCollapsed(new Set(Object.keys(groupedChanges)));
    } else {
      setCollapsed(new Set());
    }
    setExpandAll(!expandAll);
  }, [expandAll, groupedChanges]);

  const handleChangeClick = useCallback((change: TimelineChange) => {
    setSelectedChange(change);
    setDetailsLoading(true);
    setChangeDetails(null);
    vscode.postMessage({
      type: 'getChangeDetails',
      data: { changeId: change.id },
    });
  }, []);

  const toggleChangeSelection = useCallback((changeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedChanges(prev => {
      const next = new Set(prev);
      if (next.has(changeId)) {
        next.delete(changeId);
      } else {
        next.add(changeId);
      }
      return next;
    });
  }, []);

  const handleOpenFile = useCallback((filePath: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    vscode.postMessage({
      type: 'openFile',
      data: { filePath },
    });
  }, []);

  const handleCloseDetails = useCallback(() => {
    setSelectedChange(null);
    setChangeDetails(null);
  }, []);

  const handleRestore = useCallback((changeId: string, filePath: string) => {
    vscode.postMessage({
      type: 'restore',
      data: { changeId, targetPath: filePath },
    });
  }, []);

  if (!data && loading) {
    return (
      <div className="timeline-loading">
        <Spinner size="lg" />
        <p>Loading timeline...</p>
      </div>
    );
  }

  if (!data || data.changes.length === 0) {
    return (
      <EmptyState
        icon="history"
        title="No changes captured yet"
        description="Start editing files to see your code history appear here. Changes are automatically tracked as you work."
        action={
          <Button variant="primary" onClick={() => onFilter({})}>
            <i className="codicon codicon-refresh" />
            Refresh
          </Button>
        }
      />
    );
  }

  const maxHeatmapCount = Math.max(...heatmapData.map(d => d.count), 1);

  return (
    <div
      ref={timelineRef}
      className={`timeline-container ${selectedChange ? 'timeline-container--with-details' : ''}`}
    >
      {/* Main timeline panel */}
      <div className="timeline-main">
        {/* Stats Dashboard */}
        <div className="timeline-stats-dashboard">
          <div className="stats-summary">
            <div className="stat-card stat-card--primary">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">Total Changes</div>
            </div>
            <div className="stat-card stat-card--success">
              <div className="stat-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z" />
                </svg>
              </div>
              <div className="stat-content">
                <div className="stat-value">{stats.created}</div>
                <div className="stat-label">Created</div>
              </div>
            </div>
            <div className="stat-card stat-card--warning">
              <div className="stat-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M12.854 3.146a.5.5 0 0 1 0 .708l-9 9a.5.5 0 0 1-.708-.708l9-9a.5.5 0 0 1 .708 0z" />
                  <path d="M10 6.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V7h-2.5a.5.5 0 0 1-.5-.5z" />
                </svg>
              </div>
              <div className="stat-content">
                <div className="stat-value">{stats.modified}</div>
                <div className="stat-label">Modified</div>
              </div>
            </div>
            <div className="stat-card stat-card--danger">
              <div className="stat-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z" />
                </svg>
              </div>
              <div className="stat-content">
                <div className="stat-value">{stats.deleted}</div>
                <div className="stat-label">Deleted</div>
              </div>
            </div>
          </div>

          {/* Activity Heatmap */}
          <div className="activity-heatmap">
            <div className="heatmap-label">Last 7 days</div>
            <div className="heatmap-bars">
              {heatmapData.map((day, i) => (
                <Tooltip key={i} content={`${day.label}: ${day.count} changes`}>
                  <div className="heatmap-day">
                    <div
                      className="heatmap-bar"
                      style={{
                        height: `${Math.max(4, (day.count / maxHeatmapCount) * 100)}%`,
                        opacity: day.count > 0 ? 0.4 + (day.count / maxHeatmapCount) * 0.6 : 0.15,
                      }}
                    />
                    <span className="heatmap-day-label">{day.label}</span>
                  </div>
                </Tooltip>
              ))}
            </div>
          </div>

          {/* Lines changed summary */}
          <div className="lines-summary">
            <span className="lines-added">+{stats.linesAdded.toLocaleString()}</span>
            <span className="lines-removed">-{stats.linesRemoved.toLocaleString()}</span>
            <span className="files-count">{stats.files} files</span>
          </div>
        </div>

        {/* Toolbar */}
        <div className="timeline-toolbar">
          {/* Search */}
          <div className="timeline-search">
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search changes..."
              leftIcon={
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
                </svg>
              }
              rightElement={
                searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="timeline-search-clear"
                    title="Clear search"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                    </svg>
                  </button>
                )
              }
            />
          </div>

          {/* View mode toggle */}
          <div className="view-mode-toggle">
            {[
              {
                mode: 'timeline' as ViewMode,
                icon: 'M3 4h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm10 1H3v7h10V5z',
                label: 'Timeline',
              },
              {
                mode: 'cards' as ViewMode,
                icon: 'M1 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4zm6 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4z',
                label: 'Cards',
              },
              {
                mode: 'compact' as ViewMode,
                icon: 'M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v1A1.5 1.5 0 0 1 13.5 6h-11A1.5 1.5 0 0 1 1 4.5v-1zM2.5 3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11zm0 4A1.5 1.5 0 0 0 1 8.5v1A1.5 1.5 0 0 0 2.5 11h11A1.5 1.5 0 0 0 15 9.5v-1A1.5 1.5 0 0 0 13.5 7h-11z',
                label: 'Compact',
              },
            ].map(({ mode, icon, label }) => (
              <Tooltip key={mode} content={label}>
                <button
                  className={`view-mode-btn ${viewMode === mode ? 'view-mode-btn--active' : ''}`}
                  onClick={() => setViewMode(mode)}
                  title={label}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d={icon} />
                  </svg>
                </button>
              </Tooltip>
            ))}
          </div>

          {/* Toggle filters */}
          <Tooltip content={showFilters ? 'Hide filters' : 'Show filters'}>
            <button
              className={`toolbar-btn ${showFilters ? 'toolbar-btn--active' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
              title={showFilters ? 'Hide filters' : 'Show filters'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z" />
              </svg>
            </button>
          </Tooltip>
        </div>

        {/* Expanded Filters */}
        {showFilters && (
          <div className="timeline-filters-panel animate-fade-in">
            <div className="filters-row">
              {/* Group by */}
              <div className="filter-group">
                <label className="filter-label">Group by</label>
                <Select
                  value={groupBy}
                  onChange={v => setGroupBy(v as 'date' | 'file' | 'none')}
                  options={[
                    { value: 'date', label: 'Date' },
                    { value: 'file', label: 'Folder' },
                    { value: 'none', label: 'None' },
                  ]}
                  className="filter-select"
                />
              </div>

              {/* Sort by */}
              <div className="filter-group">
                <label className="filter-label">Sort</label>
                <Select
                  value={sortOrder}
                  onChange={v => setSortOrder(v as SortOrder)}
                  options={[
                    { value: 'newest', label: 'Newest first' },
                    { value: 'oldest', label: 'Oldest first' },
                    { value: 'most-changes', label: 'Most changes' },
                  ]}
                  className="filter-select"
                />
              </div>

              {/* Date range */}
              <div className="filter-group filter-group--dates">
                <label className="filter-label">Date range</label>
                <div className="date-range-inputs">
                  <input
                    type="date"
                    className="date-input"
                    value={dateRange.start}
                    onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                    max={dateRange.end || undefined}
                    title="Start date"
                    aria-label="Start date"
                  />
                  <span className="date-separator">→</span>
                  <input
                    type="date"
                    className="date-input"
                    value={dateRange.end}
                    onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                    min={dateRange.start || undefined}
                    title="End date"
                    aria-label="End date"
                  />
                  {(dateRange.start || dateRange.end) && (
                    <button
                      className="date-clear-btn"
                      onClick={() => setDateRange({ start: '', end: '' })}
                      title="Clear date filter"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Type filter chips */}
            <div className="filters-row">
              <div className="filter-group">
                <label className="filter-label">Change type</label>
                <div className="timeline-type-filters">
                  {[
                    { type: 'create', label: 'Created', color: 'success' },
                    { type: 'modify', label: 'Modified', color: 'warning' },
                    { type: 'delete', label: 'Deleted', color: 'danger' },
                  ].map(({ type, label, color }) => (
                    <button
                      key={type}
                      onClick={() => {
                        setSelectedTypes(prev =>
                          prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                        );
                      }}
                      className={`type-filter-chip type-filter-chip--${color} ${selectedTypes.includes(type) ? 'type-filter-chip--active' : ''}`}
                      title={`Filter by ${label.toLowerCase()} files`}
                    >
                      <span className="type-filter-dot" />
                      <span className="type-filter-label">{label}</span>
                      {selectedTypes.includes(type) && (
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick actions */}
              <div className="filter-actions">
                <button className="filter-action-btn" onClick={toggleExpandAll}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path
                      d={
                        expandAll
                          ? 'M4 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4zm2 4h4v4H6V6z'
                          : 'M4 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4z'
                      }
                    />
                  </svg>
                  {expandAll ? 'Collapse all' : 'Expand all'}
                </button>
                {selectedChanges.size > 0 && (
                  <button
                    className="filter-action-btn filter-action-btn--danger"
                    onClick={() => setSelectedChanges(new Set())}
                  >
                    Clear selection ({selectedChanges.size})
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Timeline content */}
        <div className={`timeline-content timeline-content--${viewMode}`}>
          {Object.entries(groupedChanges).map(([group, changes]) => (
            <div key={group} className="timeline-group">
              {/* Group header */}
              <button onClick={() => toggleGroup(group)} className="timeline-group-header">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className={`group-chevron ${collapsed.has(group) ? '' : 'group-chevron--expanded'}`}
                >
                  <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z" />
                </svg>
                <span className="timeline-group-title">{group}</span>
                <Badge variant="default">{changes.length}</Badge>
                <span className="group-stats">
                  <span className="group-stat group-stat--added">
                    +{changes.reduce((sum, c) => sum + c.linesAdded, 0)}
                  </span>
                  <span className="group-stat group-stat--removed">
                    -{changes.reduce((sum, c) => sum + c.linesRemoved, 0)}
                  </span>
                </span>
              </button>

              {/* Changes in group */}
              {!collapsed.has(group) && (
                <div className={`timeline-group-items timeline-group-items--${viewMode}`}>
                  {changes.map((change, index) =>
                    viewMode === 'compact' ? (
                      <CompactTimelineItem
                        key={change.id}
                        change={change}
                        isSelected={selectedChange?.id === change.id}
                        isChecked={selectedChanges.has(change.id)}
                        onClick={handleChangeClick}
                        onCheck={toggleChangeSelection}
                        onOpenFile={handleOpenFile}
                      />
                    ) : viewMode === 'cards' ? (
                      <CardTimelineItem
                        key={change.id}
                        change={change}
                        isSelected={selectedChange?.id === change.id}
                        isChecked={selectedChanges.has(change.id)}
                        onClick={handleChangeClick}
                        onCheck={toggleChangeSelection}
                        onOpenFile={handleOpenFile}
                      />
                    ) : (
                      <TimelineItem
                        key={change.id}
                        change={change}
                        isSelected={selectedChange?.id === change.id}
                        isChecked={selectedChanges.has(change.id)}
                        isLast={index === changes.length - 1}
                        onClick={handleChangeClick}
                        onCheck={toggleChangeSelection}
                        onOpenFile={handleOpenFile}
                      />
                    )
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Load more trigger */}
          {data.hasMore && (
            <div ref={loadMoreRef} className="timeline-load-more">
              {loading ? (
                <Spinner size="sm" />
              ) : (
                <Button variant="ghost" size="sm" onClick={onLoadMore}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z" />
                  </svg>
                  Load More
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Footer stats */}
        <div className="timeline-footer">
          <div className="footer-left">
            {selectedChanges.size > 0 && (
              <span className="footer-selection">{selectedChanges.size} selected</span>
            )}
          </div>
          <span className="footer-stats">
            {sortedChanges.length !== data.changes.length
              ? `Showing ${sortedChanges.length} of ${data.total} changes`
              : `${data.changes.length} of ${data.total} changes`}
          </span>
        </div>
      </div>

      {/* Detail panel - slides in when a change is selected */}
      {selectedChange && (
        <>
          {/* Backdrop to close panel when clicking outside */}
          <div className="timeline-detail-backdrop" onClick={handleCloseDetails} />
          <div className="timeline-detail-panel">
            <ChangeDetailPanel
              change={selectedChange}
              details={changeDetails}
              loading={detailsLoading}
              onClose={handleCloseDetails}
              onOpenFile={handleOpenFile}
              onRestore={handleRestore}
            />
          </div>
        </>
      )}
    </div>
  );
};

// Individual timeline item - Full view
interface TimelineItemProps {
  change: TimelineChange;
  isSelected: boolean;
  isChecked: boolean;
  isLast: boolean;
  onClick: (change: TimelineChange) => void;
  onCheck: (changeId: string, e: React.MouseEvent) => void;
  onOpenFile: (filePath: string, e?: React.MouseEvent) => void;
}

const TimelineItem: React.FC<TimelineItemProps> = ({
  change,
  isSelected,
  isChecked,
  isLast,
  onClick,
  onCheck,
  onOpenFile,
}) => {
  return (
    <div
      onClick={() => onClick(change)}
      className={`timeline-item timeline-item--${change.changeType} ${isSelected ? 'timeline-item--selected' : ''} ${isChecked ? 'timeline-item--checked' : ''}`}
    >
      {/* Timeline connector */}
      <div className="timeline-item-connector">
        <div className={`timeline-item-dot timeline-item-dot--${change.changeType}`}>
          {getChangeIconSvg(change.changeType)}
        </div>
        {!isLast && <div className="timeline-item-line" />}
      </div>

      {/* Content */}
      <div className="timeline-item-content">
        <div className={`timeline-item-card timeline-item-card--${change.changeType}`}>
          {/* Header row */}
          <div className="timeline-item-header">
            <button
              className={`item-checkbox ${isChecked ? 'item-checkbox--checked' : ''}`}
              onClick={e => onCheck(change.id, e)}
              title={isChecked ? 'Deselect' : 'Select'}
            >
              {isChecked && (
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
                </svg>
              )}
            </button>
            <div className="timeline-item-file">
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="file-icon"
              >
                <path d="M4 1h5v1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6h1v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" />
                <path d="M9 1v4a1 1 0 0 0 1 1h4L9 1z" />
              </svg>
              <span className="timeline-item-filename">{change.fileName}</span>
            </div>
            <div className="timeline-item-actions">
              <Tooltip content="Open file">
                <button
                  onClick={e => onOpenFile(change.filePath, e)}
                  className="timeline-action-btn"
                  title="Open file"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8.5 0a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L8 12.293V.5a.5.5 0 0 1 .5-.5z" />
                    <path d="M.5 15a.5.5 0 0 0 0 1h15a.5.5 0 0 0 0-1H.5z" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Path */}
          <p className="timeline-item-path">{change.filePath}</p>

          {/* Stats row */}
          <div className="timeline-item-stats">
            <span className="timeline-item-time">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
                <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1H8a.5.5 0 0 1-.5-.5v-3.5A.5.5 0 0 1 8 4z" />
              </svg>
              {formatTime(change.timestamp)}
            </span>

            <div className="timeline-item-changes">
              {change.linesAdded > 0 && (
                <span className="timeline-stat timeline-stat--added">+{change.linesAdded}</span>
              )}
              {change.linesRemoved > 0 && (
                <span className="timeline-stat timeline-stat--removed">-{change.linesRemoved}</span>
              )}
            </div>

            {change.language && (
              <span className={`timeline-item-lang timeline-item-lang--${change.changeType}`}>
                {change.language}
              </span>
            )}
          </div>

          {/* Summary if available */}
          {change.summary && <p className="timeline-item-summary">{change.summary}</p>}

          {/* Symbols */}
          {change.symbols && change.symbols.length > 0 && (
            <div className="timeline-item-symbols">
              {change.symbols.slice(0, 3).map(symbol => (
                <span key={symbol} className="symbol-tag">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M6 12.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z" />
                  </svg>
                  {symbol}
                </span>
              ))}
              {change.symbols.length > 3 && (
                <span className="symbol-more">+{change.symbols.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Compact timeline item
interface CompactItemProps {
  change: TimelineChange;
  isSelected: boolean;
  isChecked: boolean;
  onClick: (change: TimelineChange) => void;
  onCheck: (changeId: string, e: React.MouseEvent) => void;
  onOpenFile: (filePath: string, e?: React.MouseEvent) => void;
}

const CompactTimelineItem: React.FC<CompactItemProps> = ({
  change,
  isSelected,
  isChecked,
  onClick,
  onCheck,
  onOpenFile,
}) => {
  return (
    <div
      onClick={() => onClick(change)}
      className={`compact-item compact-item--${change.changeType} ${isSelected ? 'compact-item--selected' : ''} ${isChecked ? 'compact-item--checked' : ''}`}
    >
      <button
        className={`item-checkbox item-checkbox--sm ${isChecked ? 'item-checkbox--checked' : ''}`}
        onClick={e => onCheck(change.id, e)}
        title={isChecked ? 'Deselect' : 'Select'}
      >
        {isChecked && (
          <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
          </svg>
        )}
      </button>

      <div className={`compact-item-indicator compact-item-indicator--${change.changeType}`} />

      <span className="compact-item-filename">{change.fileName}</span>

      <span className="compact-item-time">{formatTime(change.timestamp)}</span>

      <div className="compact-item-stats">
        {change.linesAdded > 0 && (
          <span className="compact-stat compact-stat--added">+{change.linesAdded}</span>
        )}
        {change.linesRemoved > 0 && (
          <span className="compact-stat compact-stat--removed">-{change.linesRemoved}</span>
        )}
      </div>

      <button
        onClick={e => onOpenFile(change.filePath, e)}
        className="compact-item-action"
        title="Open file"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8.5 0a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L8 12.293V.5a.5.5 0 0 1 .5-.5z" />
          <path d="M.5 15a.5.5 0 0 0 0 1h15a.5.5 0 0 0 0-1H.5z" />
        </svg>
      </button>
    </div>
  );
};

// Card timeline item
const CardTimelineItem: React.FC<CompactItemProps> = ({
  change,
  isSelected,
  isChecked,
  onClick,
  onCheck,
  onOpenFile,
}) => {
  return (
    <div
      onClick={() => onClick(change)}
      className={`card-item card-item--${change.changeType} ${isSelected ? 'card-item--selected' : ''} ${isChecked ? 'card-item--checked' : ''}`}
    >
      <div className="card-item-header">
        <button
          className={`item-checkbox ${isChecked ? 'item-checkbox--checked' : ''}`}
          onClick={e => onCheck(change.id, e)}
          title={isChecked ? 'Deselect' : 'Select'}
        >
          {isChecked && (
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z" />
            </svg>
          )}
        </button>

        <div className={`card-item-type card-item-type--${change.changeType}`}>
          {getChangeIconSvg(change.changeType)}
          <span>{change.changeType}</span>
        </div>

        <button
          onClick={e => onOpenFile(change.filePath, e)}
          className="card-item-action"
          title="Open file"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8.5 0a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L8 12.293V.5a.5.5 0 0 1 .5-.5z" />
            <path d="M.5 15a.5.5 0 0 0 0 1h15a.5.5 0 0 0 0-1H.5z" />
          </svg>
        </button>
      </div>

      <div className="card-item-body">
        <div className="card-item-file">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="card-file-icon"
          >
            <path d="M4 1h5v1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6h1v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" />
            <path d="M9 1v4a1 1 0 0 0 1 1h4L9 1z" />
          </svg>
          <span className="card-item-filename">{change.fileName}</span>
        </div>
        <p className="card-item-path">{change.filePath}</p>
      </div>

      <div className="card-item-footer">
        <span className="card-item-time">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
            <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1H8a.5.5 0 0 1-.5-.5v-3.5A.5.5 0 0 1 8 4z" />
          </svg>
          {formatTime(change.timestamp)}
        </span>

        <div className="card-item-stats">
          <span className="card-stat card-stat--added">+{change.linesAdded}</span>
          <span className="card-stat card-stat--removed">-{change.linesRemoved}</span>
        </div>

        {change.language && <span className="card-item-lang">{change.language}</span>}
      </div>

      {change.symbols && change.symbols.length > 0 && (
        <div className="card-item-symbols">
          {change.symbols.slice(0, 2).map(symbol => (
            <span key={symbol} className="card-symbol">
              {symbol}
            </span>
          ))}
          {change.symbols.length > 2 && (
            <span className="card-symbol-more">+{change.symbols.length - 2}</span>
          )}
        </div>
      )}
    </div>
  );
};

function getChangeIconSvg(changeType: string): React.ReactNode {
  switch (changeType) {
    case 'create':
      return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z" />
        </svg>
      );
    case 'delete':
      return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
          <path
            fillRule="evenodd"
            d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1z"
          />
        </svg>
      );
    case 'rename':
      return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H4zm0 1h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />
          <path d="M9.5 3a.5.5 0 0 1 .5.5v5.21l2.15-2.14a.5.5 0 1 1 .7.7l-3 3a.5.5 0 0 1-.7 0l-3-3a.5.5 0 0 1 .7-.7L9 8.71V3.5a.5.5 0 0 1 .5-.5z" />
        </svg>
      );
    case 'modify':
    default:
      return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z" />
        </svg>
      );
  }
}

// Change detail panel
interface ChangeDetailPanelProps {
  change: TimelineChange;
  details: ChangeDetailsData | null;
  loading: boolean;
  onClose: () => void;
  onOpenFile: (filePath: string) => void;
  onRestore: (changeId: string, filePath: string) => void;
}

const ChangeDetailPanel: React.FC<ChangeDetailPanelProps> = ({
  change,
  details,
  loading,
  onClose,
  onOpenFile,
  onRestore,
}) => {
  const [activeTab, setActiveTab] = useState<'diff' | 'info'>('diff');

  const typeLabels: Record<string, string> = {
    create: 'File Created',
    modify: 'File Modified',
    delete: 'File Deleted',
    rename: 'File Renamed',
  };

  return (
    <div className="detail-panel">
      {/* Header */}
      <div className="detail-panel-header">
        <div className="detail-panel-title">
          <i className="codicon codicon-file-code" />
          <span>{change.fileName}</span>
        </div>
        <button onClick={onClose} className="detail-panel-close" title="Close">
          <i className="codicon codicon-close" />
        </button>
      </div>

      {/* Meta info */}
      <div className="detail-panel-meta">
        <span className={`detail-type detail-type--${change.changeType}`}>
          {typeLabels[change.changeType] || 'Modified'}
        </span>
        <span className="detail-time">
          <i className="codicon codicon-clock" />
          {formatDateTime(change.timestamp)}
        </span>
      </div>

      {/* Actions */}
      <div className="detail-panel-actions">
        <Button variant="secondary" size="sm" onClick={() => onOpenFile(change.filePath)}>
          <i className="codicon codicon-go-to-file" />
          Open File
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onRestore(change.id, change.filePath)}>
          <i className="codicon codicon-history" />
          Restore
        </Button>
      </div>

      {/* Tabs */}
      <div className="detail-panel-tabs">
        <button
          className={`detail-tab ${activeTab === 'diff' ? 'detail-tab--active' : ''}`}
          onClick={() => setActiveTab('diff')}
        >
          <i className="codicon codicon-diff" />
          Changes
        </button>
        <button
          className={`detail-tab ${activeTab === 'info' ? 'detail-tab--active' : ''}`}
          onClick={() => setActiveTab('info')}
        >
          <i className="codicon codicon-info" />
          Info
        </button>
      </div>

      {/* Content */}
      <div className="detail-panel-content">
        {loading ? (
          <div className="detail-loading">
            <Spinner size="md" />
            <p>Loading details...</p>
          </div>
        ) : activeTab === 'diff' ? (
          <DiffView details={details} />
        ) : (
          <InfoView change={change} details={details} />
        )}
      </div>
    </div>
  );
};

// Parse unified diff string into displayable lines
function parseUnifiedDiff(rawDiff: string): {
  type: 'added' | 'removed' | 'context' | 'header';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}[] {
  const lines = rawDiff.split('\n');
  const result: {
    type: 'added' | 'removed' | 'context' | 'header';
    content: string;
    oldLineNum?: number;
    newLineNum?: number;
  }[] = [];

  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    // Skip diff header lines (---, +++, etc.)
    if (
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('Index:') ||
      line.startsWith('===') ||
      line.startsWith('diff ')
    ) {
      continue;
    }

    // Parse hunk header @@ -start,count +start,count @@
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }
      result.push({ type: 'header', content: line });
      continue;
    }

    // Added line
    if (line.startsWith('+')) {
      result.push({
        type: 'added',
        content: line.slice(1),
        newLineNum: newLineNum++,
      });
    }
    // Removed line
    else if (line.startsWith('-')) {
      result.push({
        type: 'removed',
        content: line.slice(1),
        oldLineNum: oldLineNum++,
      });
    }
    // Context line (unchanged)
    else if (line.startsWith(' ') || line === '') {
      result.push({
        type: 'context',
        content: line.slice(1) || '',
        oldLineNum: oldLineNum++,
        newLineNum: newLineNum++,
      });
    }
  }

  return result;
}

// Diff view component
const DiffView: React.FC<{ details: ChangeDetailsData | null }> = ({ details }) => {
  if (!details?.diff) {
    return (
      <div className="diff-empty">
        <i className="codicon codicon-diff" />
        <p>No diff available</p>
        <span className="diff-empty-hint">The change details could not be loaded</span>
      </div>
    );
  }

  const { rawDiff, oldContent, newContent, stats } = details.diff;

  // Try to use raw diff first, fall back to content comparison
  let diffLines: {
    type: 'added' | 'removed' | 'context' | 'header';
    content: string;
    oldLineNum?: number;
    newLineNum?: number;
  }[] = [];

  if (rawDiff && rawDiff.trim()) {
    // Parse the unified diff
    diffLines = parseUnifiedDiff(rawDiff);
  } else if (oldContent || newContent) {
    // Fallback: simple line comparison
    const oldLines = (oldContent || '').split('\n');
    const newLines = (newContent || '').split('\n');

    newLines.forEach((line, i) => {
      const inOld = oldLines.includes(line);
      diffLines.push({
        type: inOld ? 'context' : 'added',
        content: line,
        newLineNum: i + 1,
      });
    });
  }

  // Filter out header lines for display, but keep them for structure
  const displayLines = diffLines.filter(l => l.type !== 'header');

  return (
    <div className="diff-view">
      {/* Stats */}
      <div className="diff-stats">
        <span className="diff-stat diff-stat--added">
          <i className="codicon codicon-add" />
          {stats.additions} addition{stats.additions !== 1 ? 's' : ''}
        </span>
        <span className="diff-stat diff-stat--removed">
          <i className="codicon codicon-remove" />
          {stats.deletions} deletion{stats.deletions !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Diff content */}
      <div className="diff-content">
        {displayLines.length > 0 ? (
          <div className="diff-code">
            <pre className="diff-pre">
              {displayLines.map((line, i) => (
                <div key={i} className={`diff-line diff-line--${line.type}`}>
                  <span className="diff-line-indicator">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span className="diff-line-num">
                    {line.type === 'removed' ? line.oldLineNum : line.newLineNum || ''}
                  </span>
                  <span className="diff-line-content">{line.content || ' '}</span>
                </div>
              ))}
            </pre>
          </div>
        ) : (
          <div className="diff-empty">
            <i className="codicon codicon-check" />
            <p>No content changes detected</p>
            <span className="diff-empty-hint">This change may only affect file metadata</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Info view component
const InfoView: React.FC<{ change: TimelineChange; details: ChangeDetailsData | null }> = ({
  change,
  details,
}) => {
  return (
    <div className="info-view">
      <div className="info-section">
        <h4 className="info-section-title">File Information</h4>
        <div className="info-grid">
          <div className="info-item">
            <span className="info-label">Path</span>
            <span className="info-value">{change.filePath}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Language</span>
            <span className="info-value">{change.language || 'Unknown'}</span>
          </div>
          {details?.metadata && (
            <>
              <div className="info-item">
                <span className="info-label">File Size</span>
                <span className="info-value">{formatBytes(details.metadata.fileSize)}</span>
              </div>
              {details.metadata.totalLines !== undefined && details.metadata.totalLines > 0 && (
                <div className="info-item">
                  <span className="info-label">Total Lines</span>
                  <span className="info-value">{details.metadata.totalLines.toLocaleString()}</span>
                </div>
              )}
              <div className="info-item">
                <span className="info-label">Encoding</span>
                <span className="info-value">{details.metadata.encoding}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="info-section">
        <h4 className="info-section-title">Change Statistics</h4>
        <div className="info-grid">
          <div className="info-item">
            <span className="info-label">Lines Added</span>
            <span className="info-value info-value--added">+{change.linesAdded}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Lines Removed</span>
            <span className="info-value info-value--removed">-{change.linesRemoved}</span>
          </div>
          {details?.metadata?.activeFunction && (
            <div className="info-item">
              <span className="info-label">Active Function</span>
              <span className="info-value">
                <i className="codicon codicon-symbol-method" />
                {details.metadata.activeFunction}
              </span>
            </div>
          )}
          {details?.metadata?.activeClass && (
            <div className="info-item">
              <span className="info-label">Active Class</span>
              <span className="info-value">
                <i className="codicon codicon-symbol-class" />
                {details.metadata.activeClass}
              </span>
            </div>
          )}
        </div>
      </div>

      {change.symbols && change.symbols.length > 0 && (
        <div className="info-section">
          <h4 className="info-section-title">Modified Symbols</h4>
          <div className="info-symbols">
            {change.symbols.map(symbol => (
              <span key={symbol} className="info-symbol">
                <i className="codicon codicon-symbol-method" />
                {symbol}
              </span>
            ))}
          </div>
        </div>
      )}

      {(change.branch || details?.metadata?.gitAuthor) && (
        <div className="info-section">
          <h4 className="info-section-title">Git Information</h4>
          <div className="info-grid">
            {change.branch && (
              <div className="info-item">
                <span className="info-label">Branch</span>
                <span className="info-value">
                  <i className="codicon codicon-git-branch" />
                  {change.branch}
                </span>
              </div>
            )}
            {change.commitHash && (
              <div className="info-item">
                <span className="info-label">Commit</span>
                <span className="info-value">
                  <i className="codicon codicon-git-commit" />
                  {change.commitHash.slice(0, 8)}
                </span>
              </div>
            )}
            {details?.metadata?.gitAuthor && (
              <div className="info-item">
                <span className="info-label">Author</span>
                <span className="info-value">
                  <i className="codicon codicon-person" />
                  {details.metadata.gitAuthor}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Utility functions
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
