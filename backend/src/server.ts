import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { AnalyzerService, ParseProgress } from './services/analyzer';
import { BackendConfig } from './config';
import { createFunctionRoutes } from './routes/functions';
import { createCallgraphRoutes } from './routes/callgraph';
import { createVariableRoutes } from './routes/variables';
import { createDataflowRoutes } from './routes/dataflow';
import { createParseRoutes } from './routes/parse';
import logger from './logger';

export function createServer(config: BackendConfig) {
  logger.info('Creating server');

  const app = express();
  app.use(cors());
  app.use(express.json());

  const analyzer = new AnalyzerService(config);

  app.use(createFunctionRoutes(analyzer));
  app.use(createCallgraphRoutes(analyzer));
  app.use(createVariableRoutes(analyzer));
  app.use(createDataflowRoutes(analyzer));
  app.use(createParseRoutes(analyzer));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = http.createServer(app);

  // WebSocket for parse progress
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    logger.info('WebSocket client connected');

    const onProgress = (progress: ParseProgress) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(progress));
      }
    };

    analyzer.on('progress', onProgress);

    ws.on('close', () => {
      logger.info('WebSocket client disconnected');
      analyzer.removeListener('progress', onProgress);
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        logger.debug('WebSocket message received', { msg });

        if (msg.type === 'config') {
          analyzer.updateConfig(msg.data);
          ws.send(JSON.stringify({ type: 'config_updated' }));
        }
      } catch {
        logger.warn('Invalid WebSocket message');
      }
    });
  });

  return { app, server, analyzer };
}
