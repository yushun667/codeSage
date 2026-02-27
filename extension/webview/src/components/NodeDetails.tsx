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
}

export const NodeDetails: React.FC<NodeDetailsProps> = ({ node, onOpenSource }) => {
  if (!node) return null;

  const fileName = node.file.split('/').pop() || node.file;

  return (
    <div className="node-info-float">
      <div className="node-info-header">
        <span className={`node-info-badge ${node.nodeType}`}>
          {node.nodeType === 'function' ? 'F' : 'V'}
        </span>
        <span className="node-info-name">{node.label}</span>
      </div>

      <div className="node-info-row">
        <span className="node-info-label">位置</span>
        <a className="node-info-link" onClick={() => onOpenSource(node.file, node.line)}>
          {fileName}:{node.line}
        </a>
      </div>

      {node.module && (
        <div className="node-info-row">
          <span className="node-info-label">模块</span>
          <span>{node.module}</span>
        </div>
      )}

      {node.signature && (
        <div className="node-info-row">
          <span className="node-info-label">签名</span>
          <code className="node-info-code">{node.signature}</code>
        </div>
      )}

      {node.varType && (
        <div className="node-info-row">
          <span className="node-info-label">类型</span>
          <code className="node-info-code">{node.varType}</code>
        </div>
      )}
    </div>
  );
};
