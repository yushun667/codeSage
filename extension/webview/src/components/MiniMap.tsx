import React from 'react';

interface MiniMapProps {
  nodeCount: number;
}

export const MiniMap: React.FC<MiniMapProps> = ({ nodeCount }) => {
  if (nodeCount === 0) return null;

  return (
    <div className="minimap">
      <div className="minimap-legend">
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#e74c3c' }} />
          <span>根节点</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: '#9b59b6' }} />
          <span>全局变量</span>
        </div>
        <div className="legend-item">
          <span className="legend-line" style={{ background: '#999' }} />
          <span>调用边</span>
        </div>
        <div className="legend-item">
          <span className="legend-line" style={{ background: '#e74c3c' }} />
          <span>写入</span>
        </div>
        <div className="legend-item">
          <span className="legend-line" style={{ background: '#3498db' }} />
          <span>读取</span>
        </div>
      </div>
    </div>
  );
};
