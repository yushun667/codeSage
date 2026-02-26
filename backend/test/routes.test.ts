import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createFunctionRoutes } from '../src/routes/functions';
import { createCallgraphRoutes } from '../src/routes/callgraph';
import { createVariableRoutes } from '../src/routes/variables';
import { createDataflowRoutes } from '../src/routes/dataflow';
import { createParseRoutes } from '../src/routes/parse';

const mockQuery = vi.fn();
const mockStartParse = vi.fn();
const mockCancelParse = vi.fn();
const mockIsParsing = vi.fn();
const mockGetStats = vi.fn();
const mockUpdateConfig = vi.fn();

const mockAnalyzer = {
  query: mockQuery,
  startParse: mockStartParse,
  cancelParse: mockCancelParse,
  isParsing: mockIsParsing,
  getStats: mockGetStats,
  updateConfig: mockUpdateConfig,
  on: vi.fn(),
  emit: vi.fn(),
  removeListener: vi.fn(),
} as any;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(createFunctionRoutes(mockAnalyzer));
  app.use(createCallgraphRoutes(mockAnalyzer));
  app.use(createVariableRoutes(mockAnalyzer));
  app.use(createDataflowRoutes(mockAnalyzer));
  app.use(createParseRoutes(mockAnalyzer));
  return app;
}

describe('Function Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('GET /api/search/functions returns search results', async () => {
    mockQuery.mockResolvedValue([
      { usr: 'u1', name: 'main', file: 'main.c', module: 'root' },
    ]);

    const res = await request(app).get('/api/search/functions?q=main');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('main');
    expect(mockQuery).toHaveBeenCalledWith('search-functions', { query: 'main', limit: '50' });
  });

  it('GET /api/functions/:usr returns function info', async () => {
    mockQuery.mockResolvedValue({ usr: 'u1', name: 'main', file: 'main.c' });

    const res = await request(app).get('/api/functions/u1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('main');
  });

  it('handles query errors gracefully', async () => {
    mockQuery.mockRejectedValue(new Error('db not found'));

    const res = await request(app).get('/api/search/functions?q=test');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('db not found');
  });
});

describe('Callgraph Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('GET /api/callgraph/forward/:usr returns forward call graph', async () => {
    mockQuery.mockResolvedValue({
      nodes: [{ usr: 'u1', name: 'main' }],
      edges: [{ caller_usr: 'u1', callee_usr: 'u2' }],
    });

    const res = await request(app).get('/api/callgraph/forward/u1?depth=3');
    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(1);
    expect(res.body.edges).toHaveLength(1);
  });

  it('GET /api/callgraph/backward/:usr returns backward call graph', async () => {
    mockQuery.mockResolvedValue({ nodes: [], edges: [] });

    const res = await request(app).get('/api/callgraph/backward/u1');
    expect(res.status).toBe(200);
  });

  it('GET /api/callgraph/path returns path between functions', async () => {
    mockQuery.mockResolvedValue({ nodes: [], edges: [] });

    const res = await request(app).get('/api/callgraph/path?from=u1&to=u2');
    expect(res.status).toBe(200);
  });
});

describe('Variable Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('GET /api/search/variables returns search results', async () => {
    mockQuery.mockResolvedValue([
      { usr: 'v1', name: 'counter', file: 'main.c', type: 'int' },
    ]);

    const res = await request(app).get('/api/search/variables?q=counter');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('GET /api/variables/:usr/accesses returns access list', async () => {
    mockQuery.mockResolvedValue([
      { var_usr: 'v1', function_usr: 'u1', is_write: true },
    ]);

    const res = await request(app).get('/api/variables/v1/accesses');
    expect(res.status).toBe(200);
  });
});

describe('Parse Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('POST /api/parse starts parsing', async () => {
    mockIsParsing.mockReturnValue(false);
    mockStartParse.mockResolvedValue(undefined);

    const res = await request(app).post('/api/parse');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('started');
  });

  it('POST /api/parse returns 409 if already parsing', async () => {
    mockIsParsing.mockReturnValue(true);

    const res = await request(app).post('/api/parse');
    expect(res.status).toBe(409);
  });

  it('GET /api/parse/status returns parsing status', async () => {
    mockIsParsing.mockReturnValue(false);

    const res = await request(app).get('/api/parse/status');
    expect(res.status).toBe(200);
    expect(res.body.parsing).toBe(false);
  });

  it('GET /api/stats returns database stats', async () => {
    mockGetStats.mockResolvedValue({ functions: 100, edges: 500, variables: 20 });

    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body.functions).toBe(100);
  });
});

describe('Dataflow Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('GET /api/dataflow/variable/:usr returns data flow graph', async () => {
    mockQuery.mockResolvedValue({
      function_nodes: [{ usr: 'u1', name: 'main' }],
      variable_nodes: [{ usr: 'v1', name: 'counter' }],
      edges: [],
    });

    const res = await request(app).get('/api/dataflow/variable/v1?depth=3');
    expect(res.status).toBe(200);
    expect(res.body.function_nodes).toHaveLength(1);
    expect(res.body.variable_nodes).toHaveLength(1);
  });
});
