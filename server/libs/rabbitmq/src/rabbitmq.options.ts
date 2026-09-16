import { RmqOptions, Transport } from '@nestjs/microservices';

/**
 * Builds the RMQ microservice listener options for a service. Each service
 * owns one durable queue; the gateway (and other services) call into it via
 * `ClientProxy.send/emit` using the same queue name as the routing key.
 */
export function rabbitmqMicroserviceOptions(rabbitmqUrl: string, queue: string): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls: [rabbitmqUrl],
      queue,
      queueOptions: { durable: true },
      noAck: true,
      persistent: true,
    },
  };
}
