import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
import Redis from 'ioredis';

/**
 * Lets several gateway replicas share one logical Socket.IO server: a
 * broadcast issued on replica A reaches sockets connected to replica B.
 * Without this, horizontal scaling silently drops real-time updates.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplication,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = new Redis(this.redisUrl);
    const subClient = pubClient.duplicate();

    // ioredis connects lazily, so this method used to return before either
    // client had reached the server: a wrong REDIS_URL surfaced much later,
    // as broadcasts that silently never crossed between gateway replicas.
    // Waiting here turns that into a failed startup, which is visible.
    await Promise.all([pubClient.ping(), subClient.ping()]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
