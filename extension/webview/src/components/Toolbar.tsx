import React from 'react';

interface ToolbarProps {
  onRunLayout: () => void;
  onExportPNG: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onUndo: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onRunLayout,
  onExportPNG,
  onZoomIn,
  onZoomOut,
  onFitView,
  onUndo,
}) => {
  return (
    <div className="fab-toolbar">
      <button className="fab-btn" onClick={onZoomIn} title="放大">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
        </svg>
      </button>
      <button className="fab-btn" onClick={onZoomOut} title="缩小">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
        </svg>
      </button>
      <button className="fab-btn" onClick={onFitView} title="适应视图">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6V3a1 1 0 011-1h3M10 2h3a1 1 0 011 1v3M14 10v3a1 1 0 01-1 1h-3M6 14H3a1 1 0 01-1-1v-3"/>
        </svg>
      </button>
      <div className="fab-divider" />
      <button className="fab-btn" onClick={onUndo} title="撤销 (Ctrl+Z)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6l-3 3 3 3"/>
          <path d="M1 9h9a4 4 0 010 0v0a4 4 0 01-4 4H5"/>
          <path d="M1 9h9a4 4 0 010 8H5"/>
        </svg>
      </button>
      <button className="fab-btn" onClick={onRunLayout} title="重新布局">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v4M8 6L5 9M8 6l3 3M3 12h10"/>
        </svg>
      </button>
      <button className="fab-btn" onClick={onExportPNG} title="导出 PNG">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v8M8 10l-3-3M8 10l3-3M3 13h10"/>
        </svg>
      </button>
    </div>
  );
};
