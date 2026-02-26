import { createServer } from './server';
import { loadConfig } from './config';
import logger from './logger';

const config = loadConfig();
const { server } = createServer(config);

server.listen(config.port, config.host, () => {
  logger.info(`CodeSage backend running at http://${config.host}:${config.port}`);
  logger.info(`WebSocket available at ws://${config.host}:${config.port}/ws`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});
