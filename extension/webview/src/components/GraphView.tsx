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
  id: string; label: string; file: string; line: number;
  module: string; color: string; nodeType: 'function' | 'variable';
  isRoot?: boolean; signature?: string; varType?: string;
}

export interface CyEdgeData {
  source: string; target: string; edgeType: string; color?: string;
}

interface ContextMenuState {
  visible: boolean; x: number; y: number; nodeId: string; nodeData: NodeData | null;
}

interface GraphViewProps {
  onNodeSelect: (data: NodeData | null) => void;
  onOpenSource: (file: string, line: number) => void;
  onExpandNode: (usr: string, direction: 'forward' | 'backward') => void;
  onSetRoot: (usr: string) => void;
}

interface UndoEntry {
  type: 'add' | 'remove' | 'move';
  elements?: ElementDefinition[];
  positions?: Array<{ id: string; x: number; y: number }>;
}

const MAX_UNDO = 50;

/* ── Styles ── */
const CY_STYLE: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      'shape': 'round-rectangle', 'width': 'label', 'height': 'label',
      'padding': '10px', 'label': 'data(label)',
      'text-valign': 'center', 'text-halign': 'center',
      'text-wrap': 'wrap', 'text-max-width': '220px',
      'font-size': '12px', 'font-family': 'Menlo, Consolas, monospace',
      'background-color': '#1e2a36', 'border-width': 2,
      'border-color': 'data(color)', 'color': '#d4d4d4',
      'text-outline-width': 0, 'min-zoomed-font-size': 0,
    } as any,
  },
  { selector: 'node[?isRoot]', style: { 'border-width': 3, 'font-weight': 'bold' } },
  { selector: 'node:selected', style: { 'border-color': '#007acc', 'border-width': 3, 'background-color': '#1a3050' } },
  { selector: 'node:active', style: { 'overlay-opacity': 0.08 } },
  {
    selector: 'edge',
    style: {
      'width': 1.5, 'line-color': '#555', 'target-arrow-color': '#555',
      'target-arrow-shape': 'triangle',
      'curve-style': 'round-taxi' as any,
      'taxi-direction': 'rightward', 'taxi-radius': 12, 'arrow-scale': 1,
    } as any,
  },
  { selector: 'edge[color]', style: { 'line-color': 'data(color)', 'target-arrow-color': 'data(color)' } },
  { selector: 'edge:selected', style: { 'line-color': '#007acc', 'target-arrow-color': '#007acc', 'width': 2.5 } },
];

const DAGRE_LAYOUT: any = {
  name: 'dagre', rankDir: 'LR', nodeSep: 40, rankSep: 180, edgeSep: 20,
  animate: true, animationDuration: 350, fit: true, padding: 40,
};

function nodeDataFromCy(node: NodeSingular): NodeData {
  const d = node.data();
  return {
    usr: d.id, label: (d.label || '').split('\n')[0],
    file: d.file || '', line: d.line || 0, module: d.module || '',
    nodeType: d.nodeType || 'function', signature: d.signature, varType: d.varType,
  };
}

function rectsIntersect(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

function rectContains(
  outer: { x1: number; y1: number; x2: number; y2: number },
  inner: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  return outer.x1 <= inner.x1 && outer.y1 <= inner.y1 && outer.x2 >= inner.x2 && outer.y2 >= inner.y2;
}

/* ── Component ── */
export const GraphView = forwardRef<GraphViewHandle, GraphViewProps>(
  ({ onNodeSelect, onOpenSource, onExpandNode, onSetRoot }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const cyRef = useRef<Core | null>(null);
    const undoStackRef = useRef<UndoEntry[]>([]);
    const dragStartPosRef = useRef<Array<{ id: string; x: number; y: number }> | null>(null);
    const selBoxRef = useRef<HTMLDivElement>(null);
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
      pushUndo({ type: 'remove', elements: eles.jsons() as ElementDefinition[] });
      eles.remove();
    }, [pushUndo]);

    useEffect(() => {
      if (!containerRef.current) return;

      const cy = cytoscape({
        container: containerRef.current,
        elements: [],
        style: CY_STYLE,
        layout: { name: 'preset' },
        boxSelectionEnabled: false,
        selectionType: 'additive',
        userZoomingEnabled: true,
        userPanningEnabled: false,
        minZoom: 0.1,
        maxZoom: 5,
        wheelSensitivity: 0.3,
      });

      cyRef.current = cy;
      const container = containerRef.current;

      /* ── Right-click drag → pan ── */
      let isPanning = false;
      let lastPanX = 0;
      let lastPanY = 0;
      let panMoved = false;

      /* ── Left-click drag on background → custom box selection ── */
      let isBoxSelecting = false;
      let boxStartX = 0;
      let boxStartY = 0;

      const onMouseDown = (e: MouseEvent) => {
        if (e.button === 2) {
          isPanning = true;
          panMoved = false;
          lastPanX = e.clientX;
          lastPanY = e.clientY;
        } else if (e.button === 0) {
          const target = (cy as any).renderer().findNearestElement(
            e.offsetX, e.offsetY, true, false,
          );
          if (!target) {
            isBoxSelecting = true;
            boxStartX = e.offsetX;
            boxStartY = e.offsetY;
            const box = selBoxRef.current;
            if (box) {
              box.style.display = 'block';
              box.style.left = `${boxStartX}px`;
              box.style.top = `${boxStartY}px`;
              box.style.width = '0';
              box.style.height = '0';
              box.className = 'selection-box ltr';
            }
          }
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
          const curX = e.offsetX;
          const curY = e.offsetY;
          const x = Math.min(boxStartX, curX);
          const y = Math.min(boxStartY, curY);
          const w = Math.abs(curX - boxStartX);
          const h = Math.abs(curY - boxStartY);
          const isLTR = curX >= boxStartX;
          const box = selBoxRef.current;
          if (box) {
            box.style.left = `${x}px`;
            box.style.top = `${y}px`;
            box.style.width = `${w}px`;
            box.style.height = `${h}px`;
            box.className = isLTR ? 'selection-box ltr' : 'selection-box rtl';
          }
        }
      };

      const onMouseUp = (e: MouseEvent) => {
        if (e.button === 2) {
          isPanning = false;
          return;
        }

        if (isBoxSelecting) {
          isBoxSelecting = false;
          const box = selBoxRef.current;
          if (box) box.style.display = 'none';

          const endX = e.offsetX;
          const endY = e.offsetY;
          const w = Math.abs(endX - boxStartX);
          const h = Math.abs(endY - boxStartY);
          if (w < 5 && h < 5) return;

          const isLTR = endX >= boxStartX;
          const selRect = {
            x1: Math.min(boxStartX, endX),
            y1: Math.min(boxStartY, endY),
            x2: Math.max(boxStartX, endX),
            y2: Math.max(boxStartY, endY),
          };

          if (!e.shiftKey) cy.nodes().unselect();

          cy.nodes().forEach(node => {
            const bb = node.renderedBoundingBox({});
            const nodeBB = { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 };
            const match = isLTR
              ? rectsIntersect(selRect, nodeBB)
              : rectContains(selRect, nodeBB);
            if (match) node.select();
          });
        }
      };

      container.addEventListener('mousedown', onMouseDown);
      container.addEventListener('mousemove', onMouseMove);
      container.addEventListener('mouseup', onMouseUp);
      container.addEventListener('contextmenu', (e) => e.preventDefault());

      /* ── Cytoscape events ── */
      cy.on('tap', 'node', (evt: EventObject) => {
        onNodeSelect(nodeDataFromCy(evt.target as NodeSingular));
      });

      cy.on('tap', (evt: EventObject) => {
        if (evt.target === cy) {
          onNodeSelect(null);
          setContextMenu(prev => ({ ...prev, visible: false }));
        }
      });

      cy.on('dbltap', 'node', (evt: EventObject) => {
        const d = (evt.target as NodeSingular).data();
        if (d.file && d.line) onOpenSource(d.file, d.line);
      });

      cy.on('cxttap', 'node', (evt: EventObject) => {
        if (panMoved) return;
        const node = evt.target as NodeSingular;
        const domEvent = evt.originalEvent as MouseEvent;
        setContextMenu({
          visible: true,
          x: domEvent.clientX,
          y: domEvent.clientY,
          nodeId: node.id(),
          nodeData: nodeDataFromCy(node),
        });
      });

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
        cy.destroy();
        cyRef.current = null;
      };
    }, [onNodeSelect, onOpenSource, pushUndo]);

    /* ── Keyboard ── */
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
          entry.elements?.forEach(el => { if (el.data?.id) cy.getElementById(el.data.id).remove(); });
          break;
        case 'remove':
          if (entry.elements) cy.add(entry.elements);
          break;
        case 'move':
          entry.positions?.forEach(({ id, x, y }) => cy.getElementById(id).position({ x, y }));
          break;
      }
    }, []);

    const runLayout = useCallback(() => {
      const cy = cyRef.current;
      if (!cy || cy.elements().length === 0) return;
      cy.layout(DAGRE_LAYOUT).run();
    }, []);

    useImperativeHandle(ref, () => ({
      loadCallGraph(nodes, edges) {
        const cy = cyRef.current;
        if (!cy) return;
        undoStackRef.current = [];
        cy.elements().remove();
        cy.add(nodes.map(n => ({ group: 'nodes' as const, data: n })));
        cy.add(edges.map(e => ({ group: 'edges' as const, data: { ...e, id: `${e.source}->${e.target}` } })));
        cy.layout(DAGRE_LAYOUT).run();
      },
      loadDataFlow(nodes, edges) {
        const cy = cyRef.current;
        if (!cy) return;
        undoStackRef.current = [];
        cy.elements().remove();
        cy.add(nodes.map(n => ({ group: 'nodes' as const, data: n })));
        cy.add(edges.map((e, i) => ({ group: 'edges' as const, data: { ...e, id: `df-${e.source}->${e.target}-${i}` } })));
        cy.layout(DAGRE_LAYOUT).run();
      },
      addNodes(nodes, edges) {
        const cy = cyRef.current;
        if (!cy) return;
        const existingIds = new Set(cy.nodes().map(n => n.id()));
        const newNodes = nodes.filter(n => !existingIds.has(n.id));
        const newEdges = edges.filter(e =>
          !cy.getElementById(`${e.source}->${e.target}`).length &&
          (existingIds.has(e.source) || newNodes.some(n => n.id === e.source)) &&
          (existingIds.has(e.target) || newNodes.some(n => n.id === e.target)));
        const added: ElementDefinition[] = [];
        if (newNodes.length) { const els = newNodes.map(n => ({ group: 'nodes' as const, data: n })); cy.add(els); added.push(...els); }
        if (newEdges.length) { const els = newEdges.map(e => ({ group: 'edges' as const, data: { ...e, id: `${e.source}->${e.target}` } })); cy.add(els); added.push(...els); }
        if (added.length) pushUndo({ type: 'add', elements: added });
        cy.layout(DAGRE_LAYOUT).run();
      },
      zoomIn() { const cy = cyRef.current; if (cy) cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }); },
      zoomOut() { const cy = cyRef.current; if (cy) cy.zoom({ level: cy.zoom() / 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }); },
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
      removeSelected() { const cy = cyRef.current; if (cy) removeWithUndo(cy, ':selected'); },
      undo() { performUndo(); },
    }), [runLayout, pushUndo, removeWithUndo, performUndo]);

    const closeMenu = useCallback(() => {
      setContextMenu(prev => ({ ...prev, visible: false }));
    }, []);

    return (
      <>
        <div ref={containerRef} className="graph-container">
          <div ref={selBoxRef} className="selection-box ltr" style={{ display: 'none' }} />
        </div>
        {contextMenu.visible && contextMenu.nodeData && (
          <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {contextMenu.nodeData.nodeType === 'function' && (
              <>
                <div className="context-item" onClick={() => { onExpandNode(contextMenu.nodeId, 'forward'); closeMenu(); }}>展开调用 &rarr;</div>
                <div className="context-item" onClick={() => { onExpandNode(contextMenu.nodeId, 'backward'); closeMenu(); }}>&larr; 展开调用者</div>
                <div className="context-item" onClick={() => { onSetRoot(contextMenu.nodeId); closeMenu(); }}>设为根节点</div>
              </>
            )}
            <div className="context-item" onClick={() => { if (contextMenu.nodeData) onOpenSource(contextMenu.nodeData.file, contextMenu.nodeData.line); closeMenu(); }}>查看源码</div>
            <div className="context-item" onClick={() => {
              const cy = cyRef.current;
              if (cy) { const el = cy.getElementById(contextMenu.nodeId); if (el.length) { pushUndo({ type: 'remove', elements: el.jsons() as ElementDefinition[] }); el.remove(); } }
              closeMenu();
            }}>从视图移除</div>
            <div className="context-item" onClick={() => { const cy = cyRef.current; if (cy) removeWithUndo(cy, ':selected'); closeMenu(); }}>删除选中节点</div>
          </div>
        )}
      </>
    );
  },
);

GraphView.displayName = 'GraphView';
