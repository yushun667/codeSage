import React, {
  useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle,
} from 'react';
import cytoscape, { Core, EventObject, NodeSingular, ElementDefinition } from 'cytoscape';
import cytoscapeDagre from 'cytoscape-dagre';
import { NodeData } from './NodeDetails';

cytoscape.use(cytoscapeDagre);

/* ── Public handle ── */
export interface GraphViewHandle {
  loadCallGraph(nodes: CyNodeData[], edges: CyEdgeData[]): void;
  loadDataFlow(nodes: CyNodeData[], edges: CyEdgeData[]): void;
  addNodes(nodes: CyNodeData[], edges: CyEdgeData[]): void;
  zoomIn(): void;
  zoomOut(): void;
  fitView(): void;
  reLayout(): void;
  exportPNG(): void;
  removeSelected(): void;
  undo(): void;
}

export interface CyNodeData {
  id: string;
  label: string;
  file: string;
  line: number;
  module: string;
  color: string;
  nodeType: 'function' | 'variable';
  isRoot?: boolean;
  signature?: string;
  varType?: string;
}

export interface CyEdgeData {
  source: string;
  target: string;
  edgeType: string;
  color?: string;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string;
  nodeData: NodeData | null;
}

interface GraphViewProps {
  onNodeSelect: (data: NodeData | null) => void;
  onOpenSource: (file: string, line: number) => void;
  onExpandNode: (usr: string, direction: 'forward' | 'backward') => void;
  onSetRoot: (usr: string) => void;
}

/* ── Undo system ── */
interface UndoEntry {
  type: 'add' | 'remove' | 'move';
  elements?: ElementDefinition[];
  positions?: Array<{ id: string; x: number; y: number }>;
}

const MAX_UNDO = 50;

/* ── Cytoscape stylesheet ── */
const CY_STYLE: cytoscape.StylesheetStyle[] = [
  {
    selector: 'core' as any,
    style: {
      'selection-box-opacity': 0,
      'active-bg-opacity': 0,
    } as any,
  },
  {
    selector: 'node',
    style: {
      'shape': 'round-rectangle',
      'width': 'label',
      'height': 'label',
      'padding': '10px',
      'label': 'data(label)',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': '220px',
      'font-size': '12px',
      'font-family': 'Menlo, Consolas, monospace',
      'background-color': '#1e2a36',
      'border-width': 2,
      'border-color': 'data(color)',
      'color': '#d4d4d4',
      'text-outline-width': 0,
      'min-zoomed-font-size': 0,
    } as any,
  },
  {
    selector: 'node[?isRoot]',
    style: { 'border-width': 3, 'font-weight': 'bold' },
  },
  {
    selector: 'node:selected',
    style: { 'border-color': '#007acc', 'border-width': 3, 'background-color': '#1a3050' },
  },
  {
    selector: 'node.box-preview',
    style: { 'border-color': '#007acc', 'border-width': 2.5, 'background-color': '#1a2e45' } as any,
  },
  {
    selector: 'node:active',
    style: { 'overlay-opacity': 0.08 },
  },
  {
    selector: 'edge',
    style: {
      'width': 1.5,
      'line-color': '#555',
      'target-arrow-color': '#555',
      'target-arrow-shape': 'triangle',
      'curve-style': 'round-taxi' as any,
      'taxi-direction': 'rightward',
      'taxi-radius': 12,
      'arrow-scale': 1,
    } as any,
  },
  {
    selector: 'edge[color]',
    style: { 'line-color': 'data(color)', 'target-arrow-color': 'data(color)' },
  },
  {
    selector: 'edge:selected',
    style: { 'line-color': '#007acc', 'target-arrow-color': '#007acc', 'width': 2.5 },
  },
];

const DAGRE_LAYOUT: any = {
  name: 'dagre',
  rankDir: 'LR',
  nodeSep: 40,
  rankSep: 180,
  edgeSep: 20,
  animate: true,
  animationDuration: 350,
  fit: true,
  padding: 40,
};

function nodeDataFromCy(node: NodeSingular): NodeData {
  const d = node.data();
  return {
    usr: d.id,
    label: (d.label || '').split('\n')[0],
    file: d.file || '',
    line: d.line || 0,
    module: d.module || '',
    nodeType: d.nodeType || 'function',
    signature: d.signature,
    varType: d.varType,
  };
}

/* ── Component ── */
export const GraphView = forwardRef<GraphViewHandle, GraphViewProps>(
  ({ onNodeSelect, onOpenSource, onExpandNode, onSetRoot }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const cyRef = useRef<Core | null>(null);
    const undoStackRef = useRef<UndoEntry[]>([]);
    const dragStartPosRef = useRef<Array<{ id: string; x: number; y: number }> | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({
      visible: false, x: 0, y: 0, nodeId: '', nodeData: null,
    });

    const pushUndo = useCallback((entry: UndoEntry) => {
      const stack = undoStackRef.current;
      stack.push(entry);
      if (stack.length > MAX_UNDO) stack.shift();
    }, []);

    const removeWithUndo = useCallback((cy: Core, selector: string) => {
      const eles = cy.elements(selector);
      if (eles.length === 0) return;
      const jsons = eles.jsons() as ElementDefinition[];
      pushUndo({ type: 'remove', elements: jsons });
      eles.remove();
    }, [pushUndo]);

    /* ── Initialize Cytoscape ── */
    useEffect(() => {
      if (!containerRef.current) return;

      const cy = cytoscape({
        container: containerRef.current,
        elements: [],
        style: CY_STYLE,
        layout: { name: 'preset' },
        boxSelectionEnabled: true,
        selectionType: 'additive',
        userZoomingEnabled: false,
        userPanningEnabled: false,
        minZoom: 0.1,
        maxZoom: 5,
      });

      cyRef.current = cy;

      /* ── Right-click drag to pan ── */
      let isPanning = false;
      let lastPanX = 0;
      let lastPanY = 0;
      let panMoved = false;

      const container = containerRef.current;

      let isBoxSelecting = false;
      let boxStartOffsetX = 0;
      let boxStartOffsetY = 0;

      const boxDiv = document.createElement('div');
      boxDiv.style.cssText =
        'position:absolute;border:1px dashed #007acc;background:rgba(0,122,204,0.06);pointer-events:none;display:none;z-index:10;box-sizing:border-box;';
      container.style.position = 'relative';
      container.appendChild(boxDiv);

      const showBoxDiv = (x: number, y: number, w: number, h: number) => {
        boxDiv.style.left = `${x}px`;
        boxDiv.style.top = `${y}px`;
        boxDiv.style.width = `${w}px`;
        boxDiv.style.height = `${h}px`;
        boxDiv.style.display = 'block';
      };
      const hideBoxDiv = () => { boxDiv.style.display = 'none'; };

      const onMouseDown = (e: MouseEvent) => {
        if (e.button === 2) {
          isPanning = true;
          panMoved = false;
          lastPanX = e.clientX;
          lastPanY = e.clientY;
        } else if (e.button === 0) {
          boxStartOffsetX = e.offsetX;
          boxStartOffsetY = e.offsetY;
        }
      };
      const onMouseMove = (e: MouseEvent) => {
        if (isPanning) {
          const dx = e.clientX - lastPanX;
          const dy = e.clientY - lastPanY;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panMoved = true;
          cy.panBy({ x: dx, y: dy });
          lastPanX = e.clientX;
          lastPanY = e.clientY;
          return;
        }
        if (isBoxSelecting) {
          const x1 = Math.min(boxStartOffsetX, e.offsetX);
          const y1 = Math.min(boxStartOffsetY, e.offsetY);
          const x2 = Math.max(boxStartOffsetX, e.offsetX);
          const y2 = Math.max(boxStartOffsetY, e.offsetY);
          showBoxDiv(x1, y1, x2 - x1, y2 - y1);
          cy.nodes().forEach(n => {
            const rp = n.renderedPosition();
            const inside = rp.x >= x1 && rp.x <= x2 && rp.y >= y1 && rp.y <= y2;
            if (inside && !n.hasClass('box-preview')) n.addClass('box-preview');
            else if (!inside && n.hasClass('box-preview')) n.removeClass('box-preview');
          });
        }
      };
      const onMouseUp = (e: MouseEvent) => {
        if (e.button === 2) isPanning = false;
        if (isBoxSelecting) {
          isBoxSelecting = false;
          hideBoxDiv();
          cy.nodes().removeClass('box-preview');
        }
      };

      cy.on('boxstart', () => { isBoxSelecting = true; });
      cy.on('boxend', () => {
        isBoxSelecting = false;
        hideBoxDiv();
        cy.nodes().removeClass('box-preview');
      });

      /* ── Mouse wheel zoom (manual, VS Code webview intercepts native wheel) ── */
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(5, cy.zoom() * factor));
        cy.zoom({
          level: newZoom,
          renderedPosition: { x: e.offsetX, y: e.offsetY },
        });
      };

      container.addEventListener('mousedown', onMouseDown);
      container.addEventListener('mousemove', onMouseMove);
      container.addEventListener('mouseup', onMouseUp);
      container.addEventListener('wheel', onWheel, { passive: false });
      container.addEventListener('contextmenu', (e) => e.preventDefault());

      /* ── Cytoscape events ── */
      cy.on('tap', 'node', (event: EventObject) => {
        onNodeSelect(nodeDataFromCy(event.target as NodeSingular));
      });

      cy.on('tap', (event: EventObject) => {
        if (event.target === cy) {
          onNodeSelect(null);
          setContextMenu(prev => ({ ...prev, visible: false }));
        }
      });

      cy.on('dbltap', 'node', (event: EventObject) => {
        const d = (event.target as NodeSingular).data();
        if (d.file && d.line) onOpenSource(d.file, d.line);
      });

      cy.on('cxttap', 'node', (event: EventObject) => {
        if (panMoved) return;
        const node = event.target as NodeSingular;
        const domEvent = event.originalEvent as MouseEvent;
        setContextMenu({
          visible: true,
          x: domEvent.clientX,
          y: domEvent.clientY,
          nodeId: node.id(),
          nodeData: nodeDataFromCy(node),
        });
      });

      /* ── Track drag for undo ── */
      cy.on('grab', 'node', () => {
        const grabbed = cy.nodes(':grabbed, :selected');
        dragStartPosRef.current = grabbed.map(n => ({
          id: n.id(), x: n.position('x'), y: n.position('y'),
        }));
      });

      cy.on('free', 'node', () => {
        if (dragStartPosRef.current && dragStartPosRef.current.length > 0) {
          pushUndo({ type: 'move', positions: dragStartPosRef.current });
          dragStartPosRef.current = null;
        }
      });

      return () => {
        container.removeEventListener('mousedown', onMouseDown);
        container.removeEventListener('mousemove', onMouseMove);
        container.removeEventListener('mouseup', onMouseUp);
        container.removeEventListener('wheel', onWheel);
        boxDiv.remove();
        cy.destroy();
        cyRef.current = null;
      };
    }, [onNodeSelect, onOpenSource, pushUndo]);

    /* ── Keyboard shortcuts ── */
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        const cy = cyRef.current;
        if (!cy) return;

        if ((e.key === 'Delete' || e.key === 'Backspace') && cy.elements(':selected').length > 0) {
          removeWithUndo(cy, ':selected');
        }

        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault();
          performUndo();
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [removeWithUndo]);

    const performUndo = useCallback(() => {
      const cy = cyRef.current;
      if (!cy) return;
      const entry = undoStackRef.current.pop();
      if (!entry) return;

      switch (entry.type) {
        case 'add':
          if (entry.elements) {
            entry.elements.forEach(el => {
              const id = el.data?.id;
              if (id) cy.getElementById(id).remove();
            });
          }
          break;
        case 'remove':
          if (entry.elements) cy.add(entry.elements);
          break;
        case 'move':
          if (entry.positions) {
            entry.positions.forEach(({ id, x, y }) => {
              cy.getElementById(id).position({ x, y });
            });
          }
          break;
      }
    }, []);

    const runLayout = useCallback(() => {
      const cy = cyRef.current;
      if (!cy || cy.elements().length === 0) return;
      cy.layout(DAGRE_LAYOUT).run();
    }, []);

    useImperativeHandle(ref, () => ({
      loadCallGraph(nodes: CyNodeData[], edges: CyEdgeData[]) {
        const cy = cyRef.current;
        if (!cy) return;
        undoStackRef.current = [];
        cy.elements().remove();
        cy.add(nodes.map(n => ({ group: 'nodes' as const, data: n })));
        cy.add(edges.map(e => ({
          group: 'edges' as const,
          data: { ...e, id: `${e.source}->${e.target}` },
        })));
        cy.layout(DAGRE_LAYOUT).run();
      },

      loadDataFlow(nodes: CyNodeData[], edges: CyEdgeData[]) {
        const cy = cyRef.current;
        if (!cy) return;
        undoStackRef.current = [];
        cy.elements().remove();
        cy.add(nodes.map(n => ({ group: 'nodes' as const, data: n })));
        cy.add(edges.map((e, i) => ({
          group: 'edges' as const,
          data: { ...e, id: `df-${e.source}->${e.target}-${i}` },
        })));
        cy.layout(DAGRE_LAYOUT).run();
      },

      addNodes(nodes: CyNodeData[], edges: CyEdgeData[]) {
        const cy = cyRef.current;
        if (!cy) return;
        const existingIds = new Set(cy.nodes().map(n => n.id()));
        const newNodes = nodes.filter(n => !existingIds.has(n.id));
        const newEdges = edges.filter(e => {
          const eid = `${e.source}->${e.target}`;
          return !cy.getElementById(eid).length &&
            (existingIds.has(e.source) || newNodes.some(n => n.id === e.source)) &&
            (existingIds.has(e.target) || newNodes.some(n => n.id === e.target));
        });
        const added: ElementDefinition[] = [];
        if (newNodes.length > 0) {
          const nodeEls = newNodes.map(n => ({ group: 'nodes' as const, data: n }));
          cy.add(nodeEls);
          added.push(...nodeEls);
        }
        if (newEdges.length > 0) {
          const edgeEls = newEdges.map(e => ({
            group: 'edges' as const,
            data: { ...e, id: `${e.source}->${e.target}` },
          }));
          cy.add(edgeEls);
          added.push(...edgeEls);
        }
        if (added.length > 0) pushUndo({ type: 'add', elements: added });
        cy.layout(DAGRE_LAYOUT).run();
      },

      zoomIn() {
        const cy = cyRef.current;
        if (cy) cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
      },
      zoomOut() {
        const cy = cyRef.current;
        if (cy) cy.zoom({ level: cy.zoom() / 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
      },
      fitView() { cyRef.current?.fit(undefined, 40); },
      reLayout() { runLayout(); },
      exportPNG() {
        const cy = cyRef.current;
        if (!cy) return;
        const link = document.createElement('a');
        link.download = 'codesage-graph.png';
        link.href = cy.png({ full: true, bg: '#1e1e1e', scale: 2 });
        link.click();
      },
      removeSelected() {
        const cy = cyRef.current;
        if (cy) removeWithUndo(cy, ':selected');
      },
      undo() { performUndo(); },
    }), [runLayout, pushUndo, removeWithUndo, performUndo]);

    const closeMenu = useCallback(() => {
      setContextMenu(prev => ({ ...prev, visible: false }));
    }, []);

    return (
      <>
        <div ref={containerRef} className="graph-container" />
        {contextMenu.visible && contextMenu.nodeData && (
          <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {contextMenu.nodeData.nodeType === 'function' && (
              <>
                <div className="context-item" onClick={() => { onExpandNode(contextMenu.nodeId, 'forward'); closeMenu(); }}>
                  展开调用 &rarr;
                </div>
                <div className="context-item" onClick={() => { onExpandNode(contextMenu.nodeId, 'backward'); closeMenu(); }}>
                  &larr; 展开调用者
                </div>
                <div className="context-item" onClick={() => { onSetRoot(contextMenu.nodeId); closeMenu(); }}>
                  设为根节点
                </div>
              </>
            )}
            <div className="context-item" onClick={() => {
              if (contextMenu.nodeData) onOpenSource(contextMenu.nodeData.file, contextMenu.nodeData.line);
              closeMenu();
            }}>查看源码</div>
            <div className="context-item" onClick={() => {
              const cy = cyRef.current;
              if (cy) {
                const el = cy.getElementById(contextMenu.nodeId);
                if (el.length) {
                  pushUndo({ type: 'remove', elements: el.jsons() as ElementDefinition[] });
                  el.remove();
                }
              }
              closeMenu();
            }}>从视图移除</div>
            <div className="context-item" onClick={() => {
              const cy = cyRef.current;
              if (cy) removeWithUndo(cy, ':selected');
              closeMenu();
            }}>删除选中节点</div>
          </div>
        )}
      </>
    );
  },
);

GraphView.displayName = 'GraphView';
