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

const App: React.FC = () => {
  const { postMessage, onMessage } = useVSCode();
  const { graph, nodeCount, edgeCount, clearGraph, loadCallGraph, loadDataFlow, addNodes } = useGraph();
  const { results, loading, search, handleResults, setResults } = useSearch();
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  // Handle messages from extension
  useEffect(() => {
    return onMessage((data: any) => {
      switch (data.type) {
        case 'loadCallGraph':
          loadCallGraph(data.data as CallGraphData, data.rootUsr);
          setTimeout(() => runForceLayout(graph), 100);
          break;
        case 'loadDataFlow':
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
    // Use sigma's canvas to export
    const canvas = document.querySelector('.graph-container canvas') as HTMLCanvasElement;
    if (canvas) {
      const link = document.createElement('a');
      link.download = 'codesage-graph.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  }, []);

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

  return (
    <div className="app">
      <div className="sidebar">
        <SearchBar onSearch={handleSearch} loading={loading} />

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
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFitView={handleFitView}
        />
        <GraphView
          graph={graph}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          sigmaRef={sigmaRef}
        />
      </div>
    </div>
  );
};

export default App;
