import React from 'react';

interface ToolbarProps {
  nodeCount: number;
  edgeCount: number;
  onClear: () => void;
  onRunLayout: () => void;
  onExportPNG: () => void;
  onExportJSON: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  nodeCount,
  edgeCount,
  onClear,
  onRunLayout,
  onExportPNG,
  onExportJSON,
  onZoomIn,
  onZoomOut,
  onFitView,
}) => {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <span className="stats">
          {nodeCount} 节点 / {edgeCount} 边
        </span>
      </div>
      <div className="toolbar-right">
        <button className="tool-btn" onClick={onZoomIn} title="放大">+</button>
        <button className="tool-btn" onClick={onZoomOut} title="缩小">-</button>
        <button className="tool-btn" onClick={onFitView} title="适应视图">⊡</button>
        <button className="tool-btn" onClick={onRunLayout} title="重新布局">布局</button>
        <button className="tool-btn" onClick={onExportPNG} title="导出PNG">PNG</button>
        <button className="tool-btn" onClick={onExportJSON} title="导出JSON">JSON</button>
        <button className="tool-btn danger" onClick={onClear} title="清空">清空</button>
      </div>
    </div>
  );
};
