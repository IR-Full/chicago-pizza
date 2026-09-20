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
      // Acknowledge after the handler finishes, not on delivery. With
      // `noAck: true` a crash mid-handler (SMTP hang, redeploy, OOM) dropped
      // the message silently — an order confirmation email could simply never
      // be sent, with nothing left in the queue to show for it.
      noAck: false,
      persistent: true,
    },
  };
}
