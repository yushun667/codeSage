import { CyNodeData, CyEdgeData } from '../components/GraphView';

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
    edge_type?: string;
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
  let hash = 0;
  for (let i = 0; i < module.length; i++) {
    hash = module.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 50%, 45%)`;
}

const EXTERNAL_COLOR = '#6c5ce7';

export function convertCallGraph(
  data: CallGraphData,
  rootUsr: string,
): { nodes: CyNodeData[]; edges: CyEdgeData[] } {
  const nodes: CyNodeData[] = data.nodes.map((n) => {
    const isExternal = !n.file || n.line === 0;
    const fileName = n.file.split('/').pop() || n.file;
    const label = isExternal ? n.name : `${n.name}\n${fileName}:${n.line}`;
    const color = n.usr === rootUsr ? '#e74c3c'
                : isExternal ? EXTERNAL_COLOR
                : getModuleColor(n.module);
    return {
      id: n.usr,
      label,
      file: n.file,
      line: n.line,
      module: n.module,
      color,
      nodeType: 'function' as const,
      isRoot: n.usr === rootUsr,
      signature: n.signature || '',
    };
  });

  const nodeSet = new Set(data.nodes.map(n => n.usr));
  const edges: CyEdgeData[] = data.edges
    .filter(e => nodeSet.has(e.caller_usr) && nodeSet.has(e.callee_usr))
    .map((e) => {
      const et = e.edge_type || 'direct';
      const isIndirect = et === 'indirect' || et === 'callback';
      return {
        source: e.caller_usr,
        target: e.callee_usr,
        edgeType: et,
        color: isIndirect ? '#e67e22' : undefined,
      };
    });

  return { nodes, edges };
}

export function convertDataFlow(
  data: DataFlowData,
): { nodes: CyNodeData[]; edges: CyEdgeData[] } {
  const nodes: CyNodeData[] = [];

  data.variable_nodes.forEach((n) => {
    const fileName = n.file.split('/').pop() || n.file;
    nodes.push({
      id: n.usr,
      label: `${n.name}\n${fileName}:${n.line}`,
      file: n.file,
      line: n.line,
      module: '',
      color: '#9b59b6',
      nodeType: 'variable',
      isRoot: true,
      varType: n.type,
    });
  });

  data.function_nodes.forEach((n) => {
    const fileName = n.file.split('/').pop() || n.file;
    nodes.push({
      id: n.usr,
      label: `${n.name}\n${fileName}:${n.line}`,
      file: n.file,
      line: n.line,
      module: n.module,
      color: getModuleColor(n.module),
      nodeType: 'function',
    });
  });

  const nodeSet = new Set(nodes.map(n => n.id));
  const edges: CyEdgeData[] = data.edges
    .filter(e => nodeSet.has(e.from_usr) && nodeSet.has(e.to_usr))
    .map((e) => {
      const edgeColor = e.type === 'call' ? '#666' :
                        e.type === 'direct_write' ? '#e74c3c' :
                        e.type === 'direct_read' ? '#3498db' : '#2ecc71';
      return {
        source: e.from_usr,
        target: e.to_usr,
        edgeType: e.type,
        color: edgeColor,
      };
    });

  return { nodes, edges };
}
