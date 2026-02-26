import { Router, Request, Response } from 'express';
import { AnalyzerService } from '../services/analyzer';
import logger from '../logger';

export function createVariableRoutes(analyzer: AnalyzerService): Router {
  const router = Router();

  router.get('/api/search/variables', async (req: Request, res: Response) => {
    const q = (req.query.q as string) || '';
    const limit = req.query.limit as string || '50';

    logger.info('GET /api/search/variables', { q, limit });

    try {
      const result = await analyzer.query('search-variables', { query: q, limit });
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Search variables failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  router.get('/api/variables/:usr', async (req: Request, res: Response) => {
    const usr = decodeURIComponent(req.params.usr);

    logger.info('GET /api/variables/:usr', { usr });

    try {
      const result = await analyzer.query('variable-info', { usr });
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Get variable info failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  router.get('/api/variables/:usr/accesses', async (req: Request, res: Response) => {
    const varUsr = decodeURIComponent(req.params.usr);
    const funcUsr = req.query.function_usr as string || '';

    logger.info('GET /api/variables/:usr/accesses', { varUsr, funcUsr });

    try {
      const args: Record<string, string> = { 'var-usr': varUsr };
      if (funcUsr) args['func-usr'] = funcUsr;

      const result = await analyzer.query('variable-accesses', args);
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Get variable accesses failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
