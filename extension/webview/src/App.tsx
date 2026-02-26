import React, { useEffect, useCallback, useRef, useState } from 'react';
import Sigma from 'sigma';
import { useVSCode } from './hooks/useVSCode';
import { useGraph, CallGraphData, DataFlowData } from './hooks/useGraph';
import { useSearch, SearchResult } from './hooks/useSearch';
import { SearchBar } from './components/SearchBar';
import { GraphView, runForceLayout } from './components/GraphView';
import { NodeDetails, NodeData } from './components/NodeDetails';
import { Toolbar } from './components/Toolbar';
import { MiniMap } from './components/MiniMap';

type EdgeFilter = 'all' | 'read' | 'write';

const App: React.FC = () => {
  const { postMessage, onMessage } = useVSCode();
  const { graph, nodeCount, edgeCount, clearGraph, loadCallGraph, loadDataFlow, addNodes } = useGraph();
  const { results, loading, search, handleResults, setResults } = useSearch();
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>('all');
  const [isDataFlowView, setIsDataFlowView] = useState(false);
  const sigmaRef = useRef<Sigma | null>(null);

  // Handle messages from extension
  useEffect(() => {
    return onMessage((data: any) => {
      switch (data.type) {
        case 'loadCallGraph':
          setIsDataFlowView(false);
          setEdgeFilter('all');
          loadCallGraph(data.data as CallGraphData, data.rootUsr);
          setTimeout(() => runForceLayout(graph), 100);
          break;
        case 'loadDataFlow':
          setIsDataFlowView(true);
          setEdgeFilter('all');
          loadDataFlow(data.data as DataFlowData, data.varUsr);
          setTimeout(() => runForceLayout(graph), 100);
          break;
        case 'addNodes':
          addNodes(data.data as CallGraphData);
          setTimeout(() => runForceLayout(graph), 100);
          break;
        case 'searchResults':
          handleResults(data.data.map((f: any) => ({
            usr: f.usr, name: f.name, file: f.file,
            line: f.line, module: f.module,
          })));
          break;
        case 'variableSearchResults':
          handleResults(data.data.map((v: any) => ({
            usr: v.usr, name: v.name, file: v.file,
            line: v.line, module: v.module, type: v.type,
          })));
          break;
      }
    });
  }, [onMessage, loadCallGraph, loadDataFlow, addNodes, handleResults, graph]);

  const handleNodeClick = useCallback((nodeData: NodeData) => {
    setSelectedNode(nodeData);
  }, []);

  const handleNodeDoubleClick = useCallback((usr: string) => {
    postMessage({ type: 'expandNode', usr, direction: 'forward' });
  }, [postMessage]);

  const handleOpenSource = useCallback((file: string, line: number) => {
    postMessage({ type: 'openSource', file, line });
  }, [postMessage]);

  const handleExpand = useCallback((usr: string, direction: 'forward' | 'backward') => {
    postMessage({ type: 'expandNode', usr, direction });
  }, [postMessage]);

  const handleSearch = useCallback((query: string, type: 'function' | 'variable') => {
    search(query, type);
  }, [search]);

  const handleFindPath = useCallback((fromUsr: string, toUsr: string) => {
    postMessage({ type: 'findPath', fromUsr, toUsr });
  }, [postMessage]);

  const handleResultClick = useCallback((result: SearchResult) => {
    if (result.type) {
      // Variable
      postMessage({ type: 'loadVariableDataFlow', varUsr: result.usr });
    } else {
      // Function
      postMessage({ type: 'loadFunctionCallGraph', funcUsr: result.usr });
    }
    setResults([]);
  }, [postMessage, setResults]);

  const handleRunLayout = useCallback(() => {
    runForceLayout(graph);
    sigmaRef.current?.refresh();
  }, [graph]);

  const handleExportPNG = useCallback(() => {
    const canvas = document.querySelector('.graph-container canvas') as HTMLCanvasElement;
    if (canvas) {
      const link = document.createElement('a');
      link.download = 'codesage-graph.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  }, []);

  const handleExportJSON = useCallback(() => {
    const nodes: Record<string, unknown>[] = [];
    const edges: Record<string, unknown>[] = [];
    graph.forEachNode((node, attrs) => {
      nodes.push({ id: node, ...attrs });
    });
    graph.forEachEdge((_edge, attrs, source, target) => {
      edges.push({ source, target, ...attrs });
    });
    const json = JSON.stringify({ nodes, edges }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = 'codesage-graph.json';
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }, [graph]);

  const handleZoomIn = useCallback(() => {
    const camera = sigmaRef.current?.getCamera();
    if (camera) {
      camera.animatedZoom({ duration: 200 });
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    const camera = sigmaRef.current?.getCamera();
    if (camera) {
      camera.animatedUnzoom({ duration: 200 });
    }
  }, []);

  const handleFitView = useCallback(() => {
    const camera = sigmaRef.current?.getCamera();
    if (camera) {
      camera.animatedReset({ duration: 300 });
    }
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

  // Keyboard navigation
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

  // Apply edge filter to graph visibility
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
      <div className="sidebar">
        <SearchBar onSearch={handleSearch} onFindPath={handleFindPath} loading={loading} />

        {results.length > 0 && (
          <div className="search-results">
            {results.map((r) => (
              <div
                key={r.usr}
                className="result-item"
                onClick={() => handleResultClick(r)}
              >
                <span className={`result-icon ${r.type ? 'var' : 'func'}`}>
                  {r.type ? 'V' : 'F'}
                </span>
                <div className="result-info">
                  <span className="result-name">{r.name}</span>
                  <span className="result-detail">
                    {r.module} — {r.file}:{r.line}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <NodeDetails
          node={selectedNode}
          onOpenSource={handleOpenSource}
          onExpand={handleExpand}
        />

        <MiniMap nodeCount={nodeCount} />
      </div>

      <div className="main-area">
        <Toolbar
          nodeCount={nodeCount}
          edgeCount={edgeCount}
          onClear={clearGraph}
          onRunLayout={handleRunLayout}
          onExportPNG={handleExportPNG}
          onExportJSON={handleExportJSON}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFitView={handleFitView}
        />
        {isDataFlowView && (
          <div className="filter-bar">
            <label>过滤:</label>
            <button className={`filter-btn ${edgeFilter === 'all' ? 'active' : ''}`} onClick={() => setEdgeFilter('all')}>全部</button>
            <button className={`filter-btn ${edgeFilter === 'read' ? 'active' : ''}`} onClick={() => setEdgeFilter('read')}>只读</button>
            <button className={`filter-btn ${edgeFilter === 'write' ? 'active' : ''}`} onClick={() => setEdgeFilter('write')}>只写</button>
          </div>
        )}
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
      </div>
    </div>
  );
};

export default App;
