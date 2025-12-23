/**
 * Diff Viewer Component
 * Side-by-side and inline diff visualization
 */

import React, { useState, useMemo } from 'react';
import type { DiffData, DiffHunk, DiffLine } from '../types';
import { Button, Tabs } from './components';

interface DiffViewerProps {
  data: DiffData;
  fileName?: string;
  oldLabel?: string;
  newLabel?: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  data,
  fileName,
  oldLabel = 'Before',
  newLabel = 'After',
}) => {
  const [viewMode, setViewMode] = useState<'split' | 'inline'>('split');
  const [expandAll, setExpandAll] = useState(false);

  return (
    <div className="h-full flex flex-col bg-[var(--vscode-editor-background)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--vscode-panel-border)]">
        <div className="flex items-center gap-4">
          {fileName && (
            <span className="font-medium text-sm text-[var(--vscode-foreground)]">{fileName}</span>
          )}

          {/* Stats */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-green-500">+{data.stats.additions}</span>
            <span className="text-red-500">-{data.stats.deletions}</span>
            <span className="text-[var(--vscode-descriptionForeground)]">
              {data.hunks.length} hunks
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Tabs
            tabs={[
              { id: 'split', label: 'Split', icon: 'split-horizontal' },
              { id: 'inline', label: 'Inline', icon: 'list-flat' },
            ]}
            activeTab={viewMode}
            onChange={id => setViewMode(id as 'split' | 'inline')}
          />

          <Button variant="ghost" size="sm" onClick={() => setExpandAll(!expandAll)}>
            {expandAll ? 'Collapse' : 'Expand'} All
          </Button>
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto font-mono text-sm">
        {viewMode === 'split' ? (
          <SplitView
            hunks={data.hunks}
            oldLabel={oldLabel}
            newLabel={newLabel}
            expandAll={expandAll}
          />
        ) : (
          <InlineView hunks={data.hunks} expandAll={expandAll} />
        )}
      </div>
    </div>
  );
};

// Split view (side-by-side)
interface SplitViewProps {
  hunks: DiffHunk[];
  oldLabel: string;
  newLabel: string;
  expandAll: boolean;
}

const SplitView: React.FC<SplitViewProps> = ({ hunks, oldLabel, newLabel, expandAll }) => {
  return (
    <div className="flex">
      {/* Old content */}
      <div className="flex-1 border-r border-[var(--vscode-panel-border)]">
        <div className="sticky top-0 z-10 px-2 py-1 text-xs font-medium bg-[var(--vscode-editorGroupHeader-tabsBackground)] text-[var(--vscode-descriptionForeground)]">
          {oldLabel}
        </div>
        {hunks.map((hunk, hunkIndex) => (
          <DiffHunkView key={hunkIndex} hunk={hunk} side="old" expandAll={expandAll} />
        ))}
      </div>

      {/* New content */}
      <div className="flex-1">
        <div className="sticky top-0 z-10 px-2 py-1 text-xs font-medium bg-[var(--vscode-editorGroupHeader-tabsBackground)] text-[var(--vscode-descriptionForeground)]">
          {newLabel}
        </div>
        {hunks.map((hunk, hunkIndex) => (
          <DiffHunkView key={hunkIndex} hunk={hunk} side="new" expandAll={expandAll} />
        ))}
      </div>
    </div>
  );
};

// Inline view
interface InlineViewProps {
  hunks: DiffHunk[];
  expandAll: boolean;
}

const InlineView: React.FC<InlineViewProps> = ({ hunks, expandAll }) => {
  return (
    <div>
      {hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex}>
          {/* Hunk header */}
          <div className="px-2 py-1 text-xs font-medium bg-[var(--vscode-editorGroupHeader-tabsBackground)] text-[var(--vscode-descriptionForeground)]">
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </div>

          {/* Lines */}
          {hunk.lines.map((line, lineIndex) => (
            <DiffLineView key={lineIndex} line={line} inline />
          ))}
        </div>
      ))}
    </div>
  );
};

// Hunk view for split mode
interface DiffHunkViewProps {
  hunk: DiffHunk;
  side: 'old' | 'new';
  expandAll: boolean;
}

const DiffHunkView: React.FC<DiffHunkViewProps> = ({ hunk, side, expandAll }) => {
  const [expanded, setExpanded] = useState(expandAll);

  React.useEffect(() => {
    setExpanded(expandAll);
  }, [expandAll]);

  const lines = useMemo(() => {
    return hunk.lines.filter(line => {
      if (side === 'old') {
        return line.type === 'context' || line.type === 'remove';
      } else {
        return line.type === 'context' || line.type === 'add';
      }
    });
  }, [hunk.lines, side]);

  return (
    <div>
      {/* Hunk header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-2 py-1 text-xs text-left font-medium bg-[var(--vscode-diffEditor-unchangedCodeBackground)] text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-list-hoverBackground)]"
      >
        <i className={`codicon codicon-chevron-${expanded ? 'down' : 'right'} mr-1`} />
        {side === 'old'
          ? `Lines ${hunk.oldStart}-${hunk.oldStart + hunk.oldLines - 1}`
          : `Lines ${hunk.newStart}-${hunk.newStart + hunk.newLines - 1}`}
      </button>

      {/* Lines */}
      {expanded &&
        lines.map((line, lineIndex) => <DiffLineView key={lineIndex} line={line} side={side} />)}
    </div>
  );
};

// Individual diff line
interface DiffLineViewProps {
  line: DiffLine;
  side?: 'old' | 'new';
  inline?: boolean;
}

const DiffLineView: React.FC<DiffLineViewProps> = ({ line, side, inline }) => {
  const bgColors: Record<DiffLine['type'], string> = {
    add: 'var(--vscode-diffEditor-insertedLineBackground)',
    remove: 'var(--vscode-diffEditor-removedLineBackground)',
    context: 'transparent',
  };

  const textColors: Record<DiffLine['type'], string> = {
    add: 'var(--vscode-diffEditor-insertedTextBackground)',
    remove: 'var(--vscode-diffEditor-removedTextBackground)',
    context: 'var(--vscode-editor-foreground)',
  };

  const lineNumber = side === 'old' ? line.oldLineNumber : line.newLineNumber;
  const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';

  return (
    <div
      className="flex items-stretch hover:bg-[var(--vscode-list-hoverBackground)]"
      style={{ backgroundColor: bgColors[line.type] }}
    >
      {/* Line number */}
      <div className="w-12 flex-shrink-0 px-2 py-0.5 text-right text-xs text-[var(--vscode-editorLineNumber-foreground)] select-none border-r border-[var(--vscode-panel-border)]">
        {lineNumber || ''}
      </div>

      {/* Prefix (for inline view) */}
      {inline && (
        <div
          className="w-6 flex-shrink-0 px-1 py-0.5 text-center select-none"
          style={{ color: textColors[line.type] }}
        >
          {prefix}
        </div>
      )}

      {/* Content */}
      <pre
        className="flex-1 px-2 py-0.5 whitespace-pre overflow-x-auto"
        style={{ color: textColors[line.type] }}
      >
        {line.content}
      </pre>
    </div>
  );
};

// Compact diff preview (for timeline hover)
interface DiffPreviewProps {
  data: DiffData;
  maxLines?: number;
}

export const DiffPreview: React.FC<DiffPreviewProps> = ({ data, maxLines = 10 }) => {
  const previewLines = useMemo(() => {
    const lines: DiffLine[] = [];
    for (const hunk of data.hunks) {
      for (const line of hunk.lines) {
        if (lines.length >= maxLines) break;
        if (line.type !== 'context') {
          lines.push(line);
        }
      }
      if (lines.length >= maxLines) break;
    }
    return lines;
  }, [data.hunks, maxLines]);

  return (
    <div className="rounded overflow-hidden border border-[var(--vscode-panel-border)]">
      {/* Stats */}
      <div className="px-2 py-1 text-xs flex items-center gap-2 bg-[var(--vscode-editorGroupHeader-tabsBackground)]">
        <span className="text-green-500">+{data.stats.additions}</span>
        <span className="text-red-500">-{data.stats.deletions}</span>
      </div>

      {/* Preview lines */}
      <div className="font-mono text-xs">
        {previewLines.map((line, index) => {
          const bgColor =
            line.type === 'add'
              ? 'var(--vscode-diffEditor-insertedLineBackground)'
              : line.type === 'remove'
                ? 'var(--vscode-diffEditor-removedLineBackground)'
                : 'transparent';

          return (
            <div key={index} className="px-2 py-0.5 truncate" style={{ backgroundColor: bgColor }}>
              <span className="mr-2 opacity-50">{line.type === 'add' ? '+' : '-'}</span>
              {line.content}
            </div>
          );
        })}

        {data.stats.additions + data.stats.deletions > maxLines && (
          <div className="px-2 py-1 text-[var(--vscode-descriptionForeground)] text-center">
            ... and {data.stats.additions + data.stats.deletions - previewLines.length} more changes
          </div>
        )}
      </div>
    </div>
  );
};
