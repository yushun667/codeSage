import { useState, useCallback, useRef } from 'react';
import Graph from 'graphology';

export interface GraphNode {
  usr: string;
  name: string;
  file: string;
  line: number;
  module: string;
  signature?: string;
  nodeType: 'function' | 'variable';
  isRoot?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  edgeType: 'call' | 'direct_read' | 'direct_write' | 'propagated';
  varUsr?: string;
}

export interface CallGraphData {
  nodes: Array<{
    usr: string;
    name: string;
    file: string;
    line: number;
    module: string;
    signature?: string;
  }>;
  edges: Array<{
    caller_usr: string;
    callee_usr: string;
    call_file?: string;
    call_line?: number;
  }>;
}

export interface DataFlowData {
  function_nodes: Array<{
    usr: string;
    name: string;
    file: string;
    line: number;
    module: string;
  }>;
  variable_nodes: Array<{
    usr: string;
    name: string;
    file: string;
    line: number;
    type: string;
  }>;
  edges: Array<{
    from_usr: string;
    to_usr: string;
    var_usr: string;
    type: string;
  }>;
}

export function useGraph() {
  const graphRef = useRef<Graph>(new Graph({ multi: false, type: 'directed' }));
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [rootNode, setRootNode] = useState<string | null>(null);

  const clearGraph = useCallback(() => {
    graphRef.current.clear();
    setNodeCount(0);
    setEdgeCount(0);
    setRootNode(null);
  }, []);

  const loadCallGraph = useCallback((data: CallGraphData, rootUsr: string) => {
    const graph = graphRef.current;
    graph.clear();

    const nodeCount = data.nodes.length;
    const angleStep = (2 * Math.PI) / Math.max(nodeCount, 1);

    data.nodes.forEach((node, i) => {
      const angle = i * angleStep;
      const radius = node.usr === rootUsr ? 0 : 5 + Math.random() * 5;
      const fileName = node.file.split('/').pop() || node.file;

      graph.addNode(node.usr, {
        label: `${node.name}\n${fileName}:${node.line}`,
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        size: node.usr === rootUsr ? 1 : 0.8,
        color: node.usr === rootUsr ? '#e74c3c' : getModuleColor(node.module),
        nodeType: 'function' as const,
        file: node.file,
        line: node.line,
        module: node.module,
        signature: node.signature || '',
        isRoot: node.usr === rootUsr,
      });
    });

    data.edges.forEach((edge) => {
      const edgeId = `${edge.caller_usr}->${edge.callee_usr}`;
      if (!graph.hasEdge(edgeId) && graph.hasNode(edge.caller_usr) && graph.hasNode(edge.callee_usr)) {
        graph.addEdgeWithKey(edgeId, edge.caller_usr, edge.callee_usr, {
          color: '#999',
          size: 0.3,
          edgeType: 'call',
        });
      }
    });

    setRootNode(rootUsr);
    setNodeCount(graph.order);
    setEdgeCount(graph.size);
  }, []);

  const loadDataFlow = useCallback((data: DataFlowData, varUsr: string) => {
    const graph = graphRef.current;
    graph.clear();

    const totalNodes = data.function_nodes.length + data.variable_nodes.length;
    const angleStep = (2 * Math.PI) / Math.max(totalNodes, 1);
    let idx = 0;

    data.variable_nodes.forEach((node) => {
      const fileName = node.file.split('/').pop() || node.file;
      graph.addNode(node.usr, {
        label: `${node.name}\n${fileName}:${node.line}`,
        x: 0,
        y: 0,
        size: 1,
        color: '#9b59b6',
        nodeType: 'variable' as const,
        file: node.file,
        line: node.line,
        module: '',
        varType: node.type,
        isRoot: true,
      });
      idx++;
    });

    data.function_nodes.forEach((node) => {
      const angle = idx * angleStep;
      const fileName = node.file.split('/').pop() || node.file;
      graph.addNode(node.usr, {
        label: `${node.name}\n${fileName}:${node.line}`,
        x: 8 * Math.cos(angle),
        y: 8 * Math.sin(angle),
        size: 0.8,
        color: getModuleColor(node.module),
        nodeType: 'function' as const,
        file: node.file,
        line: node.line,
        module: node.module,
      });
      idx++;
    });

    data.edges.forEach((edge) => {
      const edgeId = `${edge.from_usr}->${edge.to_usr}:${edge.type}`;
      if (!graph.hasEdge(edgeId) && graph.hasNode(edge.from_usr) && graph.hasNode(edge.to_usr)) {
        const edgeColor = edge.type === 'call' ? '#999' :
                          edge.type === 'direct_write' ? '#e74c3c' :
                          edge.type === 'direct_read' ? '#3498db' : '#2ecc71';
        graph.addEdgeWithKey(edgeId, edge.from_usr, edge.to_usr, {
          color: edgeColor,
          size: edge.type === 'call' ? 0.2 : 0.4,
          edgeType: edge.type,
          varUsr: edge.var_usr,
        });
      }
    });

    setRootNode(varUsr);
    setNodeCount(graph.order);
    setEdgeCount(graph.size);
  }, []);

  const addNodes = useCallback((data: CallGraphData) => {
    const graph = graphRef.current;

    data.nodes.forEach((node) => {
      if (!graph.hasNode(node.usr)) {
        const fileName = node.file.split('/').pop() || node.file;
        graph.addNode(node.usr, {
          label: `${node.name}\n${fileName}:${node.line}`,
          x: (Math.random() - 0.5) * 10,
          y: (Math.random() - 0.5) * 10,
          size: 0.8,
          color: getModuleColor(node.module),
          nodeType: 'function' as const,
          file: node.file,
          line: node.line,
          module: node.module,
          signature: node.signature || '',
        });
      }
    });

    data.edges.forEach((edge) => {
      const edgeId = `${edge.caller_usr}->${edge.callee_usr}`;
      if (!graph.hasEdge(edgeId) && graph.hasNode(edge.caller_usr) && graph.hasNode(edge.callee_usr)) {
        graph.addEdgeWithKey(edgeId, edge.caller_usr, edge.callee_usr, {
          color: '#999',
          size: 0.3,
          edgeType: 'call',
        });
      }
    });

    setNodeCount(graph.order);
    setEdgeCount(graph.size);
  }, []);

  return {
    graph: graphRef.current,
    nodeCount,
    edgeCount,
    rootNode,
    clearGraph,
    loadCallGraph,
    loadDataFlow,
    addNodes,
  };
}

const MODULE_COLORS: Record<string, string> = {
  kernel: '#2c3e50',
  mm: '#16a085',
  fs: '#2980b9',
  net: '#8e44ad',
  drivers: '#d35400',
  arch: '#c0392b',
};

function getModuleColor(module: string): string {
  if (!module) return '#7f8c8d';
  for (const [key, color] of Object.entries(MODULE_COLORS)) {
    if (module.startsWith(key)) return color;
  }
  // Hash-based color for unknown modules
  let hash = 0;
  for (let i = 0; i < module.length; i++) {
    hash = module.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 50%, 45%)`;
}
