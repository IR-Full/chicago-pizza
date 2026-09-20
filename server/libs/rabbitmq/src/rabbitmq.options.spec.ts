import { Transport } from '@nestjs/microservices';
import { rabbitmqMicroserviceOptions } from './rabbitmq.options';

describe('rabbitmqMicroserviceOptions', () => {
  const options = rabbitmqMicroserviceOptions('amqp://rabbit:5672', 'orders_queue');

  it('listens over RMQ on the given url and queue', () => {
    expect(options.transport).toBe(Transport.RMQ);
    expect(options.options).toMatchObject({ urls: ['amqp://rabbit:5672'], queue: 'orders_queue' });
  });

  it('declares the queue durable so messages survive a broker restart', () => {
    expect(options.options?.queueOptions).toEqual({ durable: true });
  });

  it('marks messages persistent', () => {
    expect(options.options?.persistent).toBe(true);
  });

  it('acknowledges only after the handler ran, so a crash redelivers', () => {
    // `noAck: true` acknowledges on delivery: a process that dies mid-handler
    // loses the message (e.g. the order-confirmation email is never sent).
    expect(options.options?.noAck).toBe(false);
  });

  it('builds independent option objects per service', () => {
    const auth = rabbitmqMicroserviceOptions('amqp://rabbit:5672', 'auth_queue');

    expect(auth.options?.queue).toBe('auth_queue');
    expect(options.options?.queue).toBe('orders_queue');
  });
});
