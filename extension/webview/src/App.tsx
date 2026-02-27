import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useVSCode } from './hooks/useVSCode';
import {
  CallGraphData, DataFlowData,
  convertCallGraph, convertDataFlow,
} from './hooks/useGraph';
import { GraphView, GraphViewHandle } from './components/GraphView';
import { NodeDetails, NodeData } from './components/NodeDetails';
import { Toolbar } from './components/Toolbar';

const App: React.FC = () => {
  const { postMessage, onMessage } = useVSCode();
  const graphRef = useRef<GraphViewHandle>(null);
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);

  useEffect(() => {
    return onMessage((data: any) => {
      const gv = graphRef.current;
      if (!gv) return;

      switch (data.type) {
        case 'loadCallGraph': {
          const { nodes, edges } = convertCallGraph(data.data as CallGraphData, data.rootUsr);
          gv.loadCallGraph(nodes, edges);
          break;
        }
        case 'loadDataFlow': {
          const { nodes, edges } = convertDataFlow(data.data as DataFlowData);
          gv.loadDataFlow(nodes, edges);
          break;
        }
        case 'addNodes': {
          const { nodes, edges } = convertCallGraph(data.data as CallGraphData, '');
          gv.addNodes(nodes, edges);
          break;
        }
      }
    });
  }, [onMessage]);

  const handleOpenSource = useCallback((file: string, line: number) => {
    postMessage({ type: 'openSource', file, line });
  }, [postMessage]);

  const handleExpandNode = useCallback((usr: string, direction: 'forward' | 'backward') => {
    postMessage({ type: 'expandNode', usr, direction });
  }, [postMessage]);

  const handleSetRoot = useCallback((usr: string) => {
    postMessage({ type: 'loadFunctionCallGraph', funcUsr: usr });
  }, [postMessage]);

  return (
    <div className="app">
      <GraphView
        ref={graphRef}
        onNodeSelect={setSelectedNode}
        onOpenSource={handleOpenSource}
        onExpandNode={handleExpandNode}
        onSetRoot={handleSetRoot}
      />

      <NodeDetails node={selectedNode} onOpenSource={handleOpenSource} />

      <Toolbar
        onRunLayout={() => graphRef.current?.reLayout()}
        onExportPNG={() => graphRef.current?.exportPNG()}
        onZoomIn={() => graphRef.current?.zoomIn()}
        onZoomOut={() => graphRef.current?.zoomOut()}
        onFitView={() => graphRef.current?.fitView()}
      />
    </div>
  );
};

export default App;
