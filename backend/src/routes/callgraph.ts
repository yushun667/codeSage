import { Router, Request, Response } from 'express';
import { AnalyzerService } from '../services/analyzer';
import logger from '../logger';

export function createCallgraphRoutes(analyzer: AnalyzerService): Router {
  const router = Router();

  router.get('/api/callgraph/forward/:usr', async (req: Request, res: Response) => {
    const usr = decodeURIComponent(req.params.usr as string);
    const depth = req.query.depth as string || '2';

    logger.info('GET /api/callgraph/forward', { usr, depth });

    try {
      const result = await analyzer.query('callgraph-forward', { usr, depth });
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Forward callgraph failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  router.get('/api/callgraph/backward/:usr', async (req: Request, res: Response) => {
    const usr = decodeURIComponent(req.params.usr as string);
    const depth = req.query.depth as string || '2';

    logger.info('GET /api/callgraph/backward', { usr, depth });

    try {
      const result = await analyzer.query('callgraph-backward', { usr, depth });
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Backward callgraph failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  router.get('/api/callgraph/path', async (req: Request, res: Response) => {
    const from = req.query.from as string || '';
    const to = req.query.to as string || '';

    logger.info('GET /api/callgraph/path', { from, to });

    try {
      const result = await analyzer.query('path', { from, to });
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Path query failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
