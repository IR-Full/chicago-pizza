// Run inside orders: node ops/check-production.cjs. Nonzero means alert.
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 5000 });
const cache = new Redis(process.env.CACHE_REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 5000 });
(async () => {
  const cutoff = new Date(Date.now() - 5 * 60_000);
  const usedMemory = Number((await redis.info('memory')).match(/used_memory:(\d+)/)?.[1] ?? 0);
  const maxMemory = Number((await redis.config('GET', 'maxmemory'))[1]);
  const metrics = {
    stateMemoryRatio: maxMemory ? usedMemory / maxMemory : 0,
    cacheReady: (await cache.ping()) === 'PONG',
    pendingOldEvents: await prisma.eventOutbox.count({
      where: { deliveredAt: null, createdAt: { lt: cutoff } },
    }),
    canceledRefunds: await prisma.payment.count({
      where: { refundStatus: 'canceled', order: { status: 'CANCELLED' } },
    }),
    overdueRefunds: await prisma.payment.count({
      where: { status: 'SUCCEEDED', order: { status: 'CANCELLED', updatedAt: { lt: cutoff } } },
    }),
    gatewayReady: (await fetch('http://gateway:4000/health/ready', { signal: AbortSignal.timeout(10_000) }))
      .ok,
    stateEvictions: Number((await redis.info('stats')).match(/evicted_keys:(\d+)/)?.[1] ?? 0),
    statePolicy: (await redis.config('GET', 'maxmemory-policy'))[1],
  };
  console.log(JSON.stringify(metrics));
  if (
    metrics.pendingOldEvents ||
    metrics.canceledRefunds ||
    metrics.overdueRefunds ||
    !metrics.gatewayReady ||
    metrics.stateEvictions ||
    metrics.statePolicy !== 'noeviction' ||
    metrics.stateMemoryRatio > 0.85 ||
    !metrics.cacheReady
  )
    process.exitCode = 1;
})()
  .catch((error) => {
    console.error('Production check failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
    cache.disconnect();
  });
