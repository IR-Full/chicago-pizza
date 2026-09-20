import { createServer, Server } from 'http';
import { Logger } from '@nestjs/common';

/**
 * The five RabbitMQ services speak no HTTP, so Docker had nothing to probe:
 * a consumer that stopped consuming stayed "up" forever. This adds the
 * smallest possible liveness endpoint to a microservice process — no Nest
 * hybrid app, no extra framework wiring, just a socket that answers while the
 * event loop is alive.
 *
 * Readiness (is the database reachable?) is deliberately not checked here:
 * these services do not serve traffic directly, and a failed check would only
 * restart a process that RabbitMQ can already route around.
 */
export function startHealthEndpoint(port: number, serviceName: string): Server {
  const server = createServer((req, res) => {
    if (req.url === '/health/live' || req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: serviceName }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'not found' }));
  });

  // The probe must never keep the process alive on its own during shutdown.
  server.unref();
  server.listen(port, '0.0.0.0', () => {
    Logger.log(`Health endpoint on :${port}/health/live`, serviceName);
  });

  return server;
}
