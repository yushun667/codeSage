import React from 'react';

export interface NodeData {
  usr: string;
  label: string;
  file: string;
  line: number;
  module: string;
  nodeType: 'function' | 'variable';
  signature?: string;
  varType?: string;
}

interface NodeDetailsProps {
  node: NodeData | null;
  onOpenSource: (file: string, line: number) => void;
  onExpand: (usr: string, direction: 'forward' | 'backward') => void;
}

export const NodeDetails: React.FC<NodeDetailsProps> = ({ node, onOpenSource, onExpand }) => {
  if (!node) {
    return (
      <div className="node-details empty">
        <p>点击节点查看详情</p>
      </div>
    );
  }

  return (
    <div className="node-details">
      <div className="detail-header">
        <span className={`node-type-badge ${node.nodeType}`}>
          {node.nodeType === 'function' ? '函数' : '变量'}
        </span>
        <h3>{node.label}</h3>
      </div>

      <div className="detail-row">
        <span className="detail-label">文件:</span>
        <a className="detail-value link" onClick={() => onOpenSource(node.file, node.line)}>
          {node.file}:{node.line}
        </a>
      </div>

      {node.module && (
        <div className="detail-row">
          <span className="detail-label">模块:</span>
          <span className="detail-value">{node.module}</span>
        </div>
      )}

      {node.signature && (
        <div className="detail-row">
          <span className="detail-label">签名:</span>
          <code className="detail-value">{node.signature}</code>
        </div>
      )}

      {node.varType && (
        <div className="detail-row">
          <span className="detail-label">类型:</span>
          <code className="detail-value">{node.varType}</code>
        </div>
      )}

      <div className="detail-row">
        <span className="detail-label">USR:</span>
        <code className="detail-value usr">{node.usr}</code>
      </div>

      {node.nodeType === 'function' && (
        <div className="detail-actions">
          <button className="action-btn" onClick={() => onExpand(node.usr, 'forward')}>
            展开调用 →
          </button>
          <button className="action-btn" onClick={() => onExpand(node.usr, 'backward')}>
            ← 展开调用者
          </button>
          <button className="action-btn" onClick={() => onOpenSource(node.file, node.line)}>
            查看源码
          </button>
        </div>
      )}
    </div>
  );
};
