import { Router, Request, Response } from 'express';
import { AnalyzerService } from '../services/analyzer';
import logger from '../logger';

export function createFunctionRoutes(analyzer: AnalyzerService): Router {
  const router = Router();

  router.get('/api/search/functions', async (req: Request, res: Response) => {
    const q = (req.query.q as string) || '';
    const limit = req.query.limit as string || '50';

    logger.info('GET /api/search/functions', { q, limit });

    try {
      const result = await analyzer.query('search-functions', { query: q, limit });
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Search functions failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  router.get('/api/functions/:usr', async (req: Request, res: Response) => {
    const usr = decodeURIComponent(req.params.usr as string);
    logger.info('GET /api/functions/:usr', { usr });

    try {
      const result = await analyzer.query('function-info', { usr });
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Get function info failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
