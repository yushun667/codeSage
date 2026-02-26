import { Router, Request, Response } from 'express';
import { AnalyzerService } from '../services/analyzer';
import logger from '../logger';

export function createDataflowRoutes(analyzer: AnalyzerService): Router {
  const router = Router();

  router.get('/api/dataflow/variable/:usr', async (req: Request, res: Response) => {
    const varUsr = decodeURIComponent(req.params.usr);
    const depth = req.query.depth as string || '3';
    const fromUsr = req.query.from_usr as string || '';
    const toUsr = req.query.to_usr as string || '';

    logger.info('GET /api/dataflow/variable/:usr', { varUsr, depth, fromUsr, toUsr });

    try {
      const args: Record<string, string> = {
        'var-usr': varUsr,
        depth,
      };
      if (fromUsr) args['from-usr'] = fromUsr;
      if (toUsr) args['to-usr'] = toUsr;

      const result = await analyzer.query('dataflow', args);
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Dataflow query failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
