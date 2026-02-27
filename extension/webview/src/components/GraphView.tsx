import React, { useEffect, useRef, useCallback, useState } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import { NodeData } from './NodeDetails';
import type { Settings } from 'sigma/settings';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';

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

function drawRectLabel(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
  settings: Settings,
): void {
  if (!data.label) return;

  const fontSize = settings.labelSize || 13;
  const font = settings.labelFont || 'sans-serif';
  const lines = data.label.split('\n');

  const padding = 6;
  const lineGap = 3;
  const firstFontSize = fontSize;
  const secondFontSize = fontSize - 2;

  context.font = `bold ${firstFontSize}px ${font}`;
  let maxWidth = context.measureText(lines[0]).width;
  if (lines.length > 1) {
    context.font = `${secondFontSize}px ${font}`;
    const w2 = context.measureText(lines[1]).width;
    if (w2 > maxWidth) maxWidth = w2;
  }

  const boxWidth = maxWidth + padding * 2;
  const totalTextHeight = lines.length > 1
    ? firstFontSize + lineGap + secondFontSize
    : firstFontSize;
  const boxHeight = totalTextHeight + padding * 2;

  const cx = data.x;
  const cy = data.y;
  const x = cx - boxWidth / 2;
  const y = cy - boxHeight / 2;

  context.fillStyle = data.highlighted ? '#2a3a4a' : '#1e2a36';
  context.strokeStyle = data.color || '#555';
  context.lineWidth = data.highlighted ? 2.5 : 1.5;
  context.beginPath();
  roundRect(context, x, y, boxWidth, boxHeight, 4);
  context.fill();
  context.stroke();

  context.textAlign = 'center';
  context.textBaseline = 'top';

  context.font = `bold ${firstFontSize}px ${font}`;
  context.fillStyle = '#e0e0e0';
  context.fillText(lines[0], cx, y + padding);

  if (lines.length > 1) {
    context.font = `${secondFontSize}px ${font}`;
    context.fillStyle = '#8899aa';
    context.fillText(lines[1], cx, y + padding + firstFontSize + lineGap);
  }
}

function drawRectHover(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
  settings: Settings,
): void {
  if (!data.label) return;

  const fontSize = settings.labelSize || 13;
  const font = settings.labelFont || 'sans-serif';
  const lines = data.label.split('\n');

  const padding = 8;
  const lineGap = 3;
  const firstFontSize = fontSize;
  const secondFontSize = fontSize - 2;

  context.font = `bold ${firstFontSize}px ${font}`;
  let maxWidth = context.measureText(lines[0]).width;
  if (lines.length > 1) {
    context.font = `${secondFontSize}px ${font}`;
    const w2 = context.measureText(lines[1]).width;
    if (w2 > maxWidth) maxWidth = w2;
  }

  const boxWidth = maxWidth + padding * 2;
  const totalTextHeight = lines.length > 1
    ? firstFontSize + lineGap + secondFontSize
    : firstFontSize;
  const boxHeight = totalTextHeight + padding * 2;

  const cx = data.x;
  const cy = data.y;
  const x = cx - boxWidth / 2;
  const y = cy - boxHeight / 2;

  context.shadowColor = 'rgba(0,122,204,0.5)';
  context.shadowBlur = 10;
  context.fillStyle = '#1a3050';
  context.strokeStyle = '#007acc';
  context.lineWidth = 2.5;
  context.beginPath();
  roundRect(context, x, y, boxWidth, boxHeight, 4);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;

  context.textAlign = 'center';
  context.textBaseline = 'top';

  context.font = `bold ${firstFontSize}px ${font}`;
  context.fillStyle = '#ffffff';
  context.fillText(lines[0], cx, y + padding);

  if (lines.length > 1) {
    context.font = `${secondFontSize}px ${font}`;
    context.fillStyle = '#88bbdd';
    context.fillText(lines[1], cx, y + padding + firstFontSize + lineGap);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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
      labelRenderedSizeThreshold: 0,
      labelSize: 13,
      labelWeight: 'bold',
      defaultEdgeType: 'arrow',
      edgeLabelSize: 10,
      zIndex: true,
      defaultDrawNodeLabel: drawRectLabel,
      defaultDrawNodeHover: drawRectHover,
      nodeReducer: (node, data) => {
        const res = { ...data };
        res.size = 2;
        res.color = 'transparent';

        if (hoveredNodeRef.current) {
          if (node === hoveredNodeRef.current ||
              graph.hasEdge(hoveredNodeRef.current, node) ||
              graph.hasEdge(node, hoveredNodeRef.current)) {
            res.highlighted = true;
          } else {
            res.label = '';
          }
        }

        if (selectedNodeRef.current === node) {
          res.highlighted = true;
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
      const rawLabel = (attrs.label || '').split('\n')[0];
      onNodeClick({
        usr: node,
        label: rawLabel,
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
      const attrs = graph.getNodeAttributes(node);
      if (attrs.file && attrs.line) {
        onOpenSource?.(attrs.file, attrs.line);
      } else {
        onNodeDoubleClick(node);
      }
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
      const rawLabel = (attrs.label || '').split('\n')[0];
      const mouseEvent = event.original as MouseEvent;
      setContextMenu({
        visible: true,
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
        nodeId: node,
        nodeData: {
          usr: node,
          label: rawLabel,
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
  }, [graph, onNodeClick, onNodeDoubleClick, onOpenSource, sigmaRef]);

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

export function runTreeLayout(graph: Graph, rootUsr?: string | null): void {
  if (graph.order === 0) return;

  let root = rootUsr || null;
  if (!root) {
    graph.forEachNode((node, attrs) => {
      if (attrs.isRoot && !root) root = node;
    });
  }
  if (!root) root = graph.nodes()[0];

  const depth: Map<string, number> = new Map();
  const parent: Map<string, string | null> = new Map();
  const children: Map<string, string[]> = new Map();
  const queue: string[] = [root];
  depth.set(root, 0);
  parent.set(root, null);
  children.set(root, []);

  while (queue.length > 0) {
    const node = queue.shift()!;
    const d = depth.get(node)!;

    graph.forEachOutNeighbor(node, (neighbor) => {
      if (!depth.has(neighbor)) {
        depth.set(neighbor, d + 1);
        parent.set(neighbor, node);
        children.set(neighbor, []);
        if (!children.has(node)) children.set(node, []);
        children.get(node)!.push(neighbor);
        queue.push(neighbor);
      }
    });

    graph.forEachInNeighbor(node, (neighbor) => {
      if (!depth.has(neighbor)) {
        depth.set(neighbor, d + 1);
        parent.set(neighbor, node);
        children.set(neighbor, []);
        if (!children.has(node)) children.set(node, []);
        children.get(node)!.push(neighbor);
        queue.push(neighbor);
      }
    });
  }

  graph.forEachNode((node) => {
    if (!depth.has(node)) {
      depth.set(node, 0);
      children.set(node, []);
    }
  });

  const xPos: Map<string, number> = new Map();
  let nextX = 0;

  function assignX(node: string): void {
    const ch = children.get(node) || [];
    if (ch.length === 0) {
      xPos.set(node, nextX);
      nextX += 1;
      return;
    }
    for (const c of ch) {
      assignX(c);
    }
    const first = xPos.get(ch[0])!;
    const last = xPos.get(ch[ch.length - 1])!;
    xPos.set(node, (first + last) / 2);
  }

  assignX(root);

  const xSpacing = 4;
  const ySpacing = 4;

  graph.forEachNode((node) => {
    const d = depth.get(node) ?? 0;
    const x = (xPos.get(node) ?? 0) * xSpacing;
    graph.setNodeAttribute(node, 'x', x);
    graph.setNodeAttribute(node, 'y', d * ySpacing);
  });
}
