import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { config } from './config.js';
import { logger } from './logger.js';
import { createApp } from './app.js';
import { createRepository } from './repository.js';

const repo = await createRepository(config);
const app = createApp({ repo, config });
const server = createServer(app);
const io = new SocketServer(server, {
  cors: { origin: config.WEB_ORIGIN, credentials: true },
  transports: ['websocket', 'polling']
});
io.on('connection', (socket) => {
  // Authenticated room membership is intentionally not enabled until roles and
  // campus grants are loaded for the socket handshake.
  socket.emit('sims:connected', { transport: socket.conn.transport.name });
});

server.listen(config.PORT, () => {
  logger.info({ port: config.PORT, storage: repo.mode }, 'SIMS API listening');
  if (repo.mode === 'memory') {
    logger.warn('Using ephemeral development memory storage; configure MySQL for durable data.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    io.close();
    await repo.close();
    process.exit(0);
  });
}
