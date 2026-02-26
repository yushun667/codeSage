import { Router, Request, Response } from 'express';
import { AnalyzerService } from '../services/analyzer';
import logger from '../logger';

export function createParseRoutes(analyzer: AnalyzerService): Router {
  const router = Router();

  router.post('/api/parse', async (_req: Request, res: Response) => {
    logger.info('POST /api/parse');

    if (analyzer.isParsing()) {
      res.status(409).json({ error: 'Parse already in progress' });
      return;
    }

    try {
      analyzer.startParse().catch((err: Error) => {
        logger.error('Parse failed in background', { error: err.message });
      });
      res.json({ status: 'started', message: 'Parse started in background' });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to start parse', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  router.post('/api/parse/cancel', (_req: Request, res: Response) => {
    logger.info('POST /api/parse/cancel');

    const cancelled = analyzer.cancelParse();
    res.json({ cancelled });
  });

  router.get('/api/parse/status', (_req: Request, res: Response) => {
    res.json({ parsing: analyzer.isParsing() });
  });

  router.get('/api/stats', async (_req: Request, res: Response) => {
    logger.info('GET /api/stats');

    try {
      const stats = await analyzer.getStats();
      res.json(stats);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Stats failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  router.post('/api/config', (req: Request, res: Response) => {
    logger.info('POST /api/config', { body: req.body });

    try {
      analyzer.updateConfig(req.body);
      res.json({ status: 'ok' });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Config update failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
