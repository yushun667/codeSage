import React, { useEffect, useCallback, useRef, useState } from 'react';
import Sigma from 'sigma';
import { useVSCode } from './hooks/useVSCode';
import { useGraph, CallGraphData, DataFlowData } from './hooks/useGraph';
import { GraphView, runTreeLayout } from './components/GraphView';
import { NodeDetails, NodeData } from './components/NodeDetails';
import { Toolbar } from './components/Toolbar';

type EdgeFilter = 'all' | 'read' | 'write';

const App: React.FC = () => {
  const { postMessage, onMessage } = useVSCode();
  const { graph, rootNode, loadCallGraph, loadDataFlow, addNodes } = useGraph();
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>('all');
  const [isDataFlowView, setIsDataFlowView] = useState(false);
  const sigmaRef = useRef<Sigma | null>(null);

  useEffect(() => {
    return onMessage((data: any) => {
      switch (data.type) {
        case 'loadCallGraph':
          setIsDataFlowView(false);
          setEdgeFilter('all');
          loadCallGraph(data.data as CallGraphData, data.rootUsr);
          setTimeout(() => {
            runTreeLayout(graph, data.rootUsr);
            sigmaRef.current?.refresh();
          }, 100);
          break;
        case 'loadDataFlow':
          setIsDataFlowView(true);
          setEdgeFilter('all');
          loadDataFlow(data.data as DataFlowData, data.varUsr);
          setTimeout(() => {
            runTreeLayout(graph, data.varUsr);
            sigmaRef.current?.refresh();
          }, 100);
          break;
        case 'addNodes':
          addNodes(data.data as CallGraphData);
          setTimeout(() => {
            runTreeLayout(graph);
            sigmaRef.current?.refresh();
          }, 100);
          break;
      }
    });
  }, [onMessage, loadCallGraph, loadDataFlow, addNodes, graph]);

  const handleNodeClick = useCallback((nodeData: NodeData) => {
    setSelectedNode(nodeData);
  }, []);

  const handleNodeDoubleClick = useCallback((usr: string) => {
    const attrs = graph.getNodeAttributes(usr);
    if (attrs?.file && attrs?.line) {
      postMessage({ type: 'openSource', file: attrs.file, line: attrs.line });
    }
  }, [postMessage, graph]);

  const handleOpenSource = useCallback((file: string, line: number) => {
    postMessage({ type: 'openSource', file, line });
  }, [postMessage]);

  const handleExpand = useCallback((usr: string, direction: 'forward' | 'backward') => {
    postMessage({ type: 'expandNode', usr, direction });
  }, [postMessage]);

  const handleRunLayout = useCallback(() => {
    runTreeLayout(graph, rootNode);
    sigmaRef.current?.refresh();
  }, [graph, rootNode]);

  const handleExportPNG = useCallback(() => {
    const canvas = document.querySelector('.graph-container canvas') as HTMLCanvasElement;
    if (canvas) {
      const link = document.createElement('a');
      link.download = 'codesage-graph.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  }, []);

  const handleZoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 200 });
  }, []);

  const handleZoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 200 });
  }, []);

  const handleFitView = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 300 });
  }, []);

  const handleRemoveNode = useCallback((usr: string) => {
    if (graph.hasNode(usr)) {
      graph.dropNode(usr);
      sigmaRef.current?.refresh();
    }
  }, [graph]);

  const handleSetRoot = useCallback((usr: string) => {
    postMessage({ type: 'loadFunctionCallGraph', funcUsr: usr });
  }, [postMessage]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const camera = sigmaRef.current?.getCamera();
      if (!camera) return;
      const step = 50;
      switch (e.key) {
        case 'ArrowUp':    camera.setState({ y: camera.getState().y - step / camera.getState().ratio }); break;
        case 'ArrowDown':  camera.setState({ y: camera.getState().y + step / camera.getState().ratio }); break;
        case 'ArrowLeft':  camera.setState({ x: camera.getState().x - step / camera.getState().ratio }); break;
        case 'ArrowRight': camera.setState({ x: camera.getState().x + step / camera.getState().ratio }); break;
        case '+': case '=': camera.animatedZoom({ duration: 150 }); break;
        case '-':            camera.animatedUnzoom({ duration: 150 }); break;
        case 'Enter':
          if (selectedNode) handleNodeDoubleClick(selectedNode.usr);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNode, handleNodeDoubleClick]);

  useEffect(() => {
    if (!isDataFlowView) return;
    graph.forEachEdge((edge, attrs) => {
      const etype = attrs.edgeType as string;
      let hidden = false;
      if (edgeFilter === 'read' && etype !== 'direct_read' && etype !== 'call') hidden = true;
      if (edgeFilter === 'write' && etype !== 'direct_write' && etype !== 'call') hidden = true;
      graph.setEdgeAttribute(edge, 'hidden', hidden);
    });
    sigmaRef.current?.refresh();
  }, [edgeFilter, isDataFlowView, graph]);

  return (
    <div className="app">
      <GraphView
        graph={graph}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeExpand={handleExpand}
        onOpenSource={handleOpenSource}
        onSetRoot={handleSetRoot}
        onRemoveNode={handleRemoveNode}
        sigmaRef={sigmaRef}
      />

      <NodeDetails node={selectedNode} onOpenSource={handleOpenSource} />

      {isDataFlowView && (
        <div className="filter-float">
          <button className={`filter-btn ${edgeFilter === 'all' ? 'active' : ''}`} onClick={() => setEdgeFilter('all')}>全部</button>
          <button className={`filter-btn ${edgeFilter === 'read' ? 'active' : ''}`} onClick={() => setEdgeFilter('read')}>只读</button>
          <button className={`filter-btn ${edgeFilter === 'write' ? 'active' : ''}`} onClick={() => setEdgeFilter('write')}>只写</button>
        </div>
      )}

      <Toolbar
        onRunLayout={handleRunLayout}
        onExportPNG={handleExportPNG}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitView={handleFitView}
      />
    </div>
  );
};

export default App;
