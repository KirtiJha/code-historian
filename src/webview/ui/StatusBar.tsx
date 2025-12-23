/**
 * Status Bar Component
 * Shows indexing status, health indicators, and quick stats
 */

import React from 'react';
import type { StatusData } from '../types';
import { Badge, ProgressBar, Tooltip } from './components';

interface StatusBarProps {
  status: StatusData | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({ status }) => {
  if (!status) {
    return (
      <div className="status-bar status-bar--loading">
        <div className="status-loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    );
  }

  return (
    <div className="status-bar">
      {/* Indexing progress - shown when active */}
      {status.indexing.active && (
        <div className="status-indexing">
          <div className="status-indexing-header">
            <span className="status-indexing-label">
              <i className="codicon codicon-sync animate-spin" />
              Indexing...
            </span>
            <span className="status-indexing-count">
              {status.indexing.processedFiles}/{status.indexing.totalFiles}
            </span>
          </div>
          <ProgressBar value={status.indexing.processedFiles} max={status.indexing.totalFiles} />
          {status.indexing.currentFile && (
            <p className="status-indexing-file">{status.indexing.currentFile}</p>
          )}
        </div>
      )}

      {/* Main status row */}
      <div className="status-main">
        {/* Quick stats */}
        <div className="status-stats">
          <Tooltip content="Total changes captured">
            <div className="status-stat">
              <i className="codicon codicon-history" />
              <span>{formatNumber(status.stats.totalChanges)}</span>
            </div>
          </Tooltip>

          <Tooltip content="Files with history">
            <div className="status-stat">
              <i className="codicon codicon-file-code" />
              <span>{formatNumber(status.stats.totalFiles)}</span>
            </div>
          </Tooltip>

          <Tooltip content="Storage used">
            <div className="status-stat">
              <i className="codicon codicon-database" />
              <span>{formatStorage(status.stats.storageUsedMb)}</span>
            </div>
          </Tooltip>
        </div>

        {/* Health indicators */}
        <div className="status-health">
          <HealthIndicator name="Database" status={status.health.database} />
          <HealthIndicator name="Vectors" status={status.health.vectorStore} />
          <HealthIndicator name="Embeddings" status={status.health.embedding} />
          <HealthIndicator name="LLM" status={status.health.llm} />
        </div>
      </div>

      {/* Last capture - subtle footer */}
      {status.stats.lastCaptureTime && (
        <div className="status-footer">
          Last capture: {formatRelativeTime(status.stats.lastCaptureTime)}
        </div>
      )}
    </div>
  );
};

// Health indicator component
interface HealthIndicatorProps {
  name: string;
  status: 'ok' | 'error' | 'initializing' | 'not-configured';
}

const HealthIndicator: React.FC<HealthIndicatorProps> = ({ name, status }) => {
  const statusIcons: Record<string, string> = {
    ok: 'check',
    error: 'error',
    initializing: 'sync',
    'not-configured': 'circle-slash',
  };

  return (
    <Tooltip content={`${name}: ${status}`}>
      <div className={`health-indicator health-indicator--${status}`}>
        <i
          className={`codicon codicon-${statusIcons[status]} ${status === 'initializing' ? 'animate-spin' : ''}`}
        />
      </div>
    </Tooltip>
  );
};

// Compact stats widget
interface StatsWidgetProps {
  status: StatusData;
}

export const StatsWidget: React.FC<StatsWidgetProps> = ({ status }) => {
  return (
    <div className="grid grid-cols-2 gap-3 p-3">
      <StatCard icon="history" label="Changes" value={formatNumber(status.stats.totalChanges)} />
      <StatCard icon="file" label="Files" value={formatNumber(status.stats.totalFiles)} />
      <StatCard icon="calendar" label="Sessions" value={formatNumber(status.stats.totalSessions)} />
      <StatCard icon="database" label="Storage" value={formatStorage(status.stats.storageUsedMb)} />
    </div>
  );
};

interface StatCardProps {
  icon: string;
  label: string;
  value: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value }) => {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)]">
      <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[var(--vscode-button-secondaryBackground)]">
        <i
          className={`codicon codicon-${icon} text-lg text-[var(--vscode-button-secondaryForeground)]`}
        />
      </div>
      <div>
        <p className="text-lg font-semibold text-[var(--vscode-foreground)]">{value}</p>
        <p className="text-xs text-[var(--vscode-descriptionForeground)]">{label}</p>
      </div>
    </div>
  );
};

// Utilities
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

function formatStorage(mb: number): string {
  if (mb >= 1024) {
    return (mb / 1024).toFixed(1) + ' GB';
  }
  return mb.toFixed(1) + ' MB';
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}
