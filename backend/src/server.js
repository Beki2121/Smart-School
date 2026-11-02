import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { config } from './config.js';
import { logger } from './logger.js';
import { createApp } from './app.js';
import { createRepository } from './repository.js';
import { createMailer } from './mailer.js';
import { startSubscriptionExpiryWorker } from './subscription-expiry-worker.js';

async function startServer() {
  const repo = await createRepository(config);
  const mailer = createMailer(config, () => repo.getMailTransportSettings());
  const app = createApp({ repo, config, mailer });
  const server = createServer(app);
  const webOrigins = [...new Set([config.WEB_ORIGIN, ...(config.WEB_ALLOWED_ORIGINS ?? [])])];
  const io = new SocketServer(server, {
    cors: { origin: webOrigins, credentials: true },
    transports: ['websocket', 'polling']
  });
  io.on('connection', (socket) => {
    // Authenticated room membership is intentionally not enabled until roles and
    // campus grants are loaded for the socket handshake.
    socket.emit('sims:connected', { transport: socket.conn.transport.name });
  });

  const stopExpiryNotificationWorker = startSubscriptionExpiryWorker(repo, mailer, logger);

  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT, storage: repo.mode }, 'SIMS API listening');
    if (repo.mode === 'memory') {
      logger.warn('Using ephemeral development memory storage; configure MySQL for durable data.');
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      stopExpiryNotificationWorker?.();
      io.close();
      await repo.close();
      process.exit(0);
    });
  }
}

startServer().catch((error) => {
  logger.error({ err: error }, 'Failed to start SIMS API');
  process.exitCode = 1;
});
