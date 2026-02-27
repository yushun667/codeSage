import React, { useEffect, useRef, useCallback, useState } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import { EdgeArrowProgram } from 'sigma/rendering';
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

/* ── Rect bounds computation (shared by renderer & hit-test) ── */

interface RectBounds {
  left: number; top: number; width: number; height: number;
}

function computeRectBounds(
  x: number, y: number, projectedSize: number,
  label: string,
  measureCtx: CanvasRenderingContext2D,
): RectBounds | null {
  if (!label) return null;

  const scale = Math.max(projectedSize / 10, 0.6);
  const fontSize = Math.max(Math.round(13 * scale), 8);
  const secondFontSize = Math.max(fontSize - 2, 7);
  const padding = Math.max(Math.round(6 * scale), 3);
  const lineGap = Math.max(Math.round(3 * scale), 2);
  const lines = label.split('\n');

  measureCtx.font = `bold ${fontSize}px sans-serif`;
  let maxWidth = measureCtx.measureText(lines[0]).width;
  if (lines.length > 1) {
    measureCtx.font = `${secondFontSize}px sans-serif`;
    const w2 = measureCtx.measureText(lines[1]).width;
    if (w2 > maxWidth) maxWidth = w2;
  }

  const boxWidth = maxWidth + padding * 2;
  const totalTextH = lines.length > 1
    ? fontSize + lineGap + secondFontSize
    : fontSize;
  const boxHeight = totalTextH + padding * 2;

  return {
    left: x - boxWidth / 2,
    top: y - boxHeight / 2,
    width: boxWidth,
    height: boxHeight,
  };
}

function hitTestNodeRect(
  sigma: Sigma,
  graph: Graph,
  measureCtx: CanvasRenderingContext2D,
  containerRect: DOMRect,
  clientX: number,
  clientY: number,
): string | null {
  const mx = clientX - containerRect.left;
  const my = clientY - containerRect.top;

  const nodes = graph.nodes();
  for (const node of nodes) {
    const dd = sigma.getNodeDisplayData(node);
    if (!dd || dd.hidden) continue;

    const label = graph.getNodeAttribute(node, 'label') as string;
    if (!label) continue;

    const bounds = computeRectBounds(dd.x, dd.y, dd.size, label, measureCtx);
    if (!bounds) continue;

    if (mx >= bounds.left && mx <= bounds.left + bounds.width &&
        my >= bounds.top && my <= bounds.top + bounds.height) {
      return node;
    }
  }
  return null;
}

/* ── Label & hover renderers ── */

function drawRectLabel(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
  settings: Settings,
): void {
  if (!data.label || data.highlighted) return;

  const scale = Math.max(data.size / 10, 0.6);
  const fontSize = Math.max(Math.round(13 * scale), 8);
  const font = settings.labelFont || 'sans-serif';
  const lines = data.label.split('\n');

  const padding = Math.max(Math.round(6 * scale), 3);
  const lineGap = Math.max(Math.round(3 * scale), 2);
  const secondFontSize = Math.max(fontSize - 2, 7);

  context.font = `bold ${fontSize}px ${font}`;
  let maxWidth = context.measureText(lines[0]).width;
  if (lines.length > 1) {
    context.font = `${secondFontSize}px ${font}`;
    const w2 = context.measureText(lines[1]).width;
    if (w2 > maxWidth) maxWidth = w2;
  }

  const boxWidth = maxWidth + padding * 2;
  const totalTextHeight = lines.length > 1
    ? fontSize + lineGap + secondFontSize
    : fontSize;
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

  context.font = `bold ${fontSize}px ${font}`;
  context.fillStyle = '#e0e0e0';
  context.fillText(lines[0], cx, y + padding);

  if (lines.length > 1) {
    context.font = `${secondFontSize}px ${font}`;
    context.fillStyle = '#8899aa';
    context.fillText(lines[1], cx, y + padding + fontSize + lineGap);
  }
}

function drawRectHover(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
  settings: Settings,
): void {
  if (!data.label) return;

  const scale = Math.max(data.size / 10, 0.6);
  const fontSize = Math.max(Math.round(14 * scale), 9);
  const font = settings.labelFont || 'sans-serif';
  const lines = data.label.split('\n');

  const padding = Math.max(Math.round(8 * scale), 4);
  const lineGap = Math.max(Math.round(3 * scale), 2);
  const secondFontSize = Math.max(fontSize - 2, 7);

  context.font = `bold ${fontSize}px ${font}`;
  let maxWidth = context.measureText(lines[0]).width;
  if (lines.length > 1) {
    context.font = `${secondFontSize}px ${font}`;
    const w2 = context.measureText(lines[1]).width;
    if (w2 > maxWidth) maxWidth = w2;
  }

  const boxWidth = maxWidth + padding * 2;
  const totalTextHeight = lines.length > 1
    ? fontSize + lineGap + secondFontSize
    : fontSize;
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

  context.font = `bold ${fontSize}px ${font}`;
  context.fillStyle = '#ffffff';
  context.fillText(lines[0], cx, y + padding);

  if (lines.length > 1) {
    context.font = `${secondFontSize}px ${font}`;
    context.fillStyle = '#88bbdd';
    context.fillText(lines[1], cx, y + padding + fontSize + lineGap);
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

/* ── Helper: extract NodeData from graph attributes ── */

function nodeDataFromAttrs(node: string, graph: Graph): NodeData {
  const attrs = graph.getNodeAttributes(node);
  return {
    usr: node,
    label: ((attrs.label as string) || '').split('\n')[0],
    file: (attrs.file as string) || '',
    line: (attrs.line as number) || 0,
    module: (attrs.module as string) || '',
    nodeType: (attrs.nodeType as 'function' | 'variable') || 'function',
    signature: attrs.signature as string | undefined,
    varType: attrs.varType as string | undefined,
  };
}

/* ── Component ── */

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
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, nodeId: '', nodeData: null,
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d')!;
    measureCtxRef.current = measureCtx;
    const container = containerRef.current;

    const sigma = new Sigma(graph, container, {
      renderLabels: true,
      labelRenderedSizeThreshold: 0,
      labelSize: 13,
      labelWeight: 'bold',
      labelDensity: 1,
      labelGridCellSize: 100,
      defaultEdgeType: 'arrow',
      edgeLabelSize: 10,
      zIndex: true,
      itemSizesReference: 'positions',
      minEdgeThickness: 0.5,
      doubleClickZoomingRatio: 1,
      doubleClickZoomingDuration: 0,
      defaultDrawNodeLabel: drawRectLabel,
      defaultDrawNodeHover: drawRectHover,
      edgeProgramClasses: {
        arrow: EdgeArrowProgram,
      },
      nodeReducer: (node, data) => {
        const res = { ...data };
        res.color = '#00000000';

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

    /* ── Rect-based hit testing replaces Sigma's circle-based events ── */

    function hitNode(e: MouseEvent | TouchEvent): string | null {
      let cx: number, cy: number;
      if ('clientX' in e) {
        cx = e.clientX;
        cy = e.clientY;
      } else if (e.touches.length > 0) {
        cx = e.touches[0].clientX;
        cy = e.touches[0].clientY;
      } else {
        return null;
      }
      return hitTestNodeRect(sigma, graph, measureCtx, container.getBoundingClientRect(), cx, cy);
    }

    const handleClick = (original: MouseEvent | TouchEvent) => {
      const node = hitNode(original);
      if (node) {
        selectedNodeRef.current = node;
        onNodeClick(nodeDataFromAttrs(node, graph));
      } else {
        selectedNodeRef.current = null;
        setContextMenu(prev => ({ ...prev, visible: false }));
      }
      sigma.refresh();
    };

    const handleDoubleClick = (original: MouseEvent | TouchEvent) => {
      const node = hitNode(original);
      if (node) {
        const attrs = graph.getNodeAttributes(node);
        if (attrs.file && attrs.line) {
          onOpenSource?.(attrs.file, attrs.line);
        } else {
          onNodeDoubleClick(node);
        }
      }
    };

    const handleRightClick = (original: MouseEvent | TouchEvent) => {
      const node = hitNode(original);
      if (node) {
        original.preventDefault();
        const nd = nodeDataFromAttrs(node, graph);
        const me = original as MouseEvent;
        setContextMenu({
          visible: true,
          x: me.clientX,
          y: me.clientY,
          nodeId: node,
          nodeData: nd,
        });
      } else {
        setContextMenu(prev => ({ ...prev, visible: false }));
      }
    };

    sigma.on('clickStage', ({ event }) => handleClick(event.original));
    sigma.on('clickNode', ({ event }) => handleClick(event.original));

    sigma.on('doubleClickStage', ({ event }) => {
      event.preventSigmaDefault();
      handleDoubleClick(event.original);
    });
    sigma.on('doubleClickNode', ({ event }) => {
      event.preventSigmaDefault();
      handleDoubleClick(event.original);
    });

    sigma.on('rightClickStage', ({ event }) => {
      event.preventSigmaDefault();
      handleRightClick(event.original);
    });
    sigma.on('rightClickNode', ({ event }) => {
      event.preventSigmaDefault();
      handleRightClick(event.original);
    });

    const handleMouseMove = (e: MouseEvent) => {
      if (e.buttons !== 0) return;
      const node = hitNode(e);
      if (node !== hoveredNodeRef.current) {
        hoveredNodeRef.current = node;
        container.style.cursor = node ? 'pointer' : 'grab';
        sigma.refresh();
      }
    };

    container.addEventListener('mousemove', handleMouseMove);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
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

/**
 * Bidirectional horizontal tree layout.
 * Root sits at center (x=0). Out-neighbors (callees) expand rightward (+x),
 * in-neighbors (callers) expand leftward (-x). Y-axis spreads siblings.
 */
export function runTreeLayout(graph: Graph, rootUsr?: string | null): void {
  if (graph.order === 0) return;

  let root = rootUsr || null;
  if (!root) {
    graph.forEachNode((node, attrs) => {
      if (attrs.isRoot && !root) root = node;
    });
  }
  if (!root) root = graph.nodes()[0];

  const level: Map<string, number> = new Map();
  const treeChildren: Map<string, string[]> = new Map();
  level.set(root, 0);
  treeChildren.set(root, []);

  const fwdQueue: string[] = [root];
  while (fwdQueue.length > 0) {
    const node = fwdQueue.shift()!;
    const d = level.get(node)!;
    graph.forEachOutNeighbor(node, (neighbor) => {
      if (!level.has(neighbor)) {
        level.set(neighbor, d + 1);
        treeChildren.set(neighbor, []);
        if (!treeChildren.has(node)) treeChildren.set(node, []);
        treeChildren.get(node)!.push(neighbor);
        fwdQueue.push(neighbor);
      }
    });
  }

  const bwdQueue: string[] = [root];
  while (bwdQueue.length > 0) {
    const node = bwdQueue.shift()!;
    const d = level.get(node)!;
    graph.forEachInNeighbor(node, (neighbor) => {
      if (!level.has(neighbor)) {
        level.set(neighbor, d - 1);
        treeChildren.set(neighbor, []);
        if (!treeChildren.has(node)) treeChildren.set(node, []);
        treeChildren.get(node)!.push(neighbor);
        bwdQueue.push(neighbor);
      }
    });
  }

  graph.forEachNode((node) => {
    if (!level.has(node)) {
      level.set(node, 0);
      treeChildren.set(node, []);
    }
  });

  const ySlot: Map<string, number> = new Map();
  let nextSlot = 0;

  function assignY(node: string): void {
    const ch = treeChildren.get(node) || [];
    if (ch.length === 0) {
      ySlot.set(node, nextSlot);
      nextSlot += 1;
      return;
    }
    for (const c of ch) {
      assignY(c);
    }
    const first = ySlot.get(ch[0])!;
    const last = ySlot.get(ch[ch.length - 1])!;
    ySlot.set(node, (first + last) / 2);
  }

  assignY(root);

  graph.forEachNode((node) => {
    if (!ySlot.has(node)) {
      ySlot.set(node, nextSlot);
      nextSlot += 1;
    }
  });

  const xSpacing = 6;
  const ySpacing = 3;

  graph.forEachNode((node) => {
    const lv = level.get(node) ?? 0;
    const ys = ySlot.get(node) ?? 0;
    graph.setNodeAttribute(node, 'x', lv * xSpacing);
    graph.setNodeAttribute(node, 'y', ys * ySpacing);
  });
}
