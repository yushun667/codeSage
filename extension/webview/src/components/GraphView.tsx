import React, { useEffect, useRef, useCallback, useState } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { NodeData } from './NodeDetails';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string;
  nodeData: NodeData | null;
}

interface GraphViewProps {
  graph: Graph;
  onNodeClick: (nodeData: NodeData) => void;
  onNodeDoubleClick: (usr: string) => void;
  onNodeExpand?: (usr: string, direction: 'forward' | 'backward') => void;
  onOpenSource?: (file: string, line: number) => void;
  onSetRoot?: (usr: string) => void;
  onRemoveNode?: (usr: string) => void;
  sigmaRef: React.MutableRefObject<Sigma | null>;
}

export const GraphView: React.FC<GraphViewProps> = ({
  graph,
  onNodeClick,
  onNodeDoubleClick,
  onNodeExpand,
  onOpenSource,
  onSetRoot,
  onRemoveNode,
  sigmaRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, nodeId: '', nodeData: null,
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const sigma = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelRenderedSizeThreshold: 5,
      labelSize: 12,
      labelWeight: 'bold',
      defaultEdgeType: 'arrow',
      edgeLabelSize: 10,
      zIndex: true,
      nodeReducer: (node, data) => {
        const res = { ...data };

        if (hoveredNodeRef.current) {
          if (node === hoveredNodeRef.current ||
              graph.hasEdge(hoveredNodeRef.current, node) ||
              graph.hasEdge(node, hoveredNodeRef.current)) {
            res.highlighted = true;
          } else {
            res.color = `${res.color}40`;
            res.label = '';
          }
        }

        if (selectedNodeRef.current === node) {
          res.highlighted = true;
          res.size = (res.size || 8) * 1.3;
        }

        return res;
      },
      edgeReducer: (edge, data) => {
        const res = { ...data };
        if (hoveredNodeRef.current) {
          const [source, target] = graph.extremities(edge);
          if (source !== hoveredNodeRef.current && target !== hoveredNodeRef.current) {
            res.hidden = true;
          }
        }
        return res;
      },
    });

    sigmaRef.current = sigma;

    sigma.on('clickNode', ({ node }) => {
      selectedNodeRef.current = node;
      const attrs = graph.getNodeAttributes(node);
      onNodeClick({
        usr: node,
        label: attrs.label || '',
        file: attrs.file || '',
        line: attrs.line || 0,
        module: attrs.module || '',
        nodeType: attrs.nodeType || 'function',
        signature: attrs.signature,
        varType: attrs.varType,
      });
      sigma.refresh();
    });

    sigma.on('doubleClickNode', ({ node }) => {
      onNodeDoubleClick(node);
    });

    sigma.on('enterNode', ({ node }) => {
      hoveredNodeRef.current = node;
      sigma.refresh();
    });

    sigma.on('leaveNode', () => {
      hoveredNodeRef.current = null;
      sigma.refresh();
    });

    sigma.on('clickStage', () => {
      selectedNodeRef.current = null;
      setContextMenu(prev => ({ ...prev, visible: false }));
      sigma.refresh();
    });

    sigma.on('rightClickNode', ({ node, event }) => {
      event.original.preventDefault();
      const attrs = graph.getNodeAttributes(node);
      setContextMenu({
        visible: true,
        x: event.original.clientX,
        y: event.original.clientY,
        nodeId: node,
        nodeData: {
          usr: node,
          label: attrs.label || '',
          file: attrs.file || '',
          line: attrs.line || 0,
          module: attrs.module || '',
          nodeType: attrs.nodeType || 'function',
          signature: attrs.signature,
          varType: attrs.varType,
        },
      });
    });

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [graph, onNodeClick, onNodeDoubleClick, sigmaRef]);

  // Re-render when graph changes
  useEffect(() => {
    const handler = () => {
      sigmaRef.current?.refresh();
    };
    graph.on('nodeAdded', handler);
    graph.on('edgeAdded', handler);
    graph.on('nodeAttributesUpdated', handler);

    return () => {
      graph.removeListener('nodeAdded', handler);
      graph.removeListener('edgeAdded', handler);
      graph.removeListener('nodeAttributesUpdated', handler);
    };
  }, [graph, sigmaRef]);

  const closeMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  return (
    <>
      <div ref={containerRef} className="graph-container" onContextMenu={e => e.preventDefault()} />
      {contextMenu.visible && contextMenu.nodeData && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.nodeData.nodeType === 'function' && (
            <>
              <div className="context-item" onClick={() => {
                onNodeExpand?.(contextMenu.nodeId, 'forward');
                closeMenu();
              }}>展开调用 &rarr;</div>
              <div className="context-item" onClick={() => {
                onNodeExpand?.(contextMenu.nodeId, 'backward');
                closeMenu();
              }}>&larr; 展开调用者</div>
              <div className="context-item" onClick={() => {
                onSetRoot?.(contextMenu.nodeId);
                closeMenu();
              }}>设为根节点</div>
            </>
          )}
          <div className="context-item" onClick={() => {
            if (contextMenu.nodeData) onOpenSource?.(contextMenu.nodeData.file, contextMenu.nodeData.line);
            closeMenu();
          }}>查看源码</div>
          <div className="context-item" onClick={() => {
            onRemoveNode?.(contextMenu.nodeId);
            closeMenu();
          }}>从视图移除</div>
        </div>
      )}
    </>
  );
};

export function runForceLayout(graph: Graph): void {
  if (graph.order === 0) return;

  forceAtlas2.assign(graph, {
    iterations: 100,
    settings: {
      gravity: 1,
      scalingRatio: 5,
      strongGravityMode: false,
      barnesHutOptimize: graph.order > 500,
    },
  });
}
