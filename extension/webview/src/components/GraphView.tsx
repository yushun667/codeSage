import React, {
  useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle,
} from 'react';
import cytoscape, { Core, EventObject, NodeSingular } from 'cytoscape';
import cytoscapeDagre from 'cytoscape-dagre';
import { NodeData } from './NodeDetails';

cytoscape.use(cytoscapeDagre);

/* ── Public handle exposed via ref ── */
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

/* ── Context menu state ── */
interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string;
  nodeData: NodeData | null;
}

/* ── Props ── */
interface GraphViewProps {
  onNodeSelect: (data: NodeData | null) => void;
  onOpenSource: (file: string, line: number) => void;
  onExpandNode: (usr: string, direction: 'forward' | 'backward') => void;
  onSetRoot: (usr: string) => void;
}

/* ── Cytoscape stylesheet ── */
const CY_STYLE: cytoscape.StylesheetStyle[] = [
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
    style: {
      'border-width': 3,
      'font-weight': 'bold',
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-color': '#007acc',
      'border-width': 3,
      'background-color': '#1a3050',
    },
  },
  {
    selector: 'node:active',
    style: {
      'overlay-opacity': 0.08,
    },
  },
  {
    selector: 'edge',
    style: {
      'width': 1.5,
      'line-color': '#555',
      'target-arrow-color': '#555',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'arrow-scale': 1,
    },
  },
  {
    selector: 'edge[color]',
    style: {
      'line-color': 'data(color)',
      'target-arrow-color': 'data(color)',
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': '#007acc',
      'target-arrow-color': '#007acc',
      'width': 2.5,
    },
  },
];

/* ── Dagre layout options ── */
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

/* ── Helper: extract NodeData from a Cytoscape node ── */
function nodeDataFromCy(node: NodeSingular): NodeData {
  const d = node.data();
  const rawLabel = (d.label || '').split('\n')[0];
  return {
    usr: d.id,
    label: rawLabel,
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
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({
      visible: false, x: 0, y: 0, nodeId: '', nodeData: null,
    });

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
        userZoomingEnabled: true,
        userPanningEnabled: true,
        minZoom: 0.1,
        maxZoom: 5,
        wheelSensitivity: 0.3,
      });

      cyRef.current = cy;

      /* Single click → show info */
      cy.on('tap', 'node', (event: EventObject) => {
        const node = event.target as NodeSingular;
        onNodeSelect(nodeDataFromCy(node));
      });

      /* Click on empty area → deselect, close menu */
      cy.on('tap', (event: EventObject) => {
        if (event.target === cy) {
          onNodeSelect(null);
          setContextMenu(prev => ({ ...prev, visible: false }));
        }
      });

      /* Double click → jump to source code */
      cy.on('dbltap', 'node', (event: EventObject) => {
        const d = (event.target as NodeSingular).data();
        if (d.file && d.line) {
          onOpenSource(d.file, d.line);
        }
      });

      /* Right click → context menu */
      cy.on('cxttap', 'node', (event: EventObject) => {
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

      /* Prevent browser context menu on the container */
      containerRef.current.addEventListener('contextmenu', (e) => e.preventDefault());

      return () => {
        cy.destroy();
        cyRef.current = null;
      };
    }, [onNodeSelect, onOpenSource]);

    /* ── Keyboard shortcuts ── */
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        const cy = cyRef.current;
        if (!cy) return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
          cy.elements(':selected').remove();
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, []);

    /* ── Expose methods via ref ── */
    const runLayout = useCallback(() => {
      const cy = cyRef.current;
      if (!cy || cy.elements().length === 0) return;
      cy.layout(DAGRE_LAYOUT).run();
    }, []);

    useImperativeHandle(ref, () => ({
      loadCallGraph(nodes: CyNodeData[], edges: CyEdgeData[]) {
        const cy = cyRef.current;
        if (!cy) return;
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
        const existingEdges = new Set(cy.edges().map(e => e.id()));
        const newEdges = edges.filter(e => {
          const eid = `${e.source}->${e.target}`;
          return !existingEdges.has(eid) && (existingIds.has(e.source) || newNodes.some(n => n.id === e.source))
            && (existingIds.has(e.target) || newNodes.some(n => n.id === e.target));
        });
        if (newNodes.length > 0) {
          cy.add(newNodes.map(n => ({ group: 'nodes' as const, data: n })));
        }
        if (newEdges.length > 0) {
          cy.add(newEdges.map(e => ({
            group: 'edges' as const,
            data: { ...e, id: `${e.source}->${e.target}` },
          })));
        }
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

      fitView() {
        cyRef.current?.fit(undefined, 40);
      },

      reLayout() {
        runLayout();
      },

      exportPNG() {
        const cy = cyRef.current;
        if (!cy) return;
        const png = cy.png({ full: true, bg: '#1e1e1e', scale: 2 });
        const link = document.createElement('a');
        link.download = 'codesage-graph.png';
        link.href = png;
        link.click();
      },

      removeSelected() {
        cyRef.current?.elements(':selected').remove();
      },
    }), [runLayout]);

    /* ── Context menu actions ── */
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
                <div className="context-item" onClick={() => {
                  onExpandNode(contextMenu.nodeId, 'forward');
                  closeMenu();
                }}>展开调用 &rarr;</div>
                <div className="context-item" onClick={() => {
                  onExpandNode(contextMenu.nodeId, 'backward');
                  closeMenu();
                }}>&larr; 展开调用者</div>
                <div className="context-item" onClick={() => {
                  onSetRoot(contextMenu.nodeId);
                  closeMenu();
                }}>设为根节点</div>
              </>
            )}
            <div className="context-item" onClick={() => {
              if (contextMenu.nodeData) onOpenSource(contextMenu.nodeData.file, contextMenu.nodeData.line);
              closeMenu();
            }}>查看源码</div>
            <div className="context-item" onClick={() => {
              cyRef.current?.getElementById(contextMenu.nodeId).remove();
              closeMenu();
            }}>从视图移除</div>
            <div className="context-item" onClick={() => {
              cyRef.current?.elements(':selected').remove();
              closeMenu();
            }}>删除选中节点</div>
          </div>
        )}
      </>
    );
  },
);

GraphView.displayName = 'GraphView';
