import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { RabbitmqClientModule } from './rabbitmq-client.module';

type AsyncClient = {
  name: string;
  inject: unknown[];
  useFactory: (config: ConfigService) => { transport: number; options: Record<string, unknown> };
};

/** Pulls the registrations back out of the dynamic module Nest would build. */
function registrationsOf(clients: { name: string; queue: string }[]): AsyncClient[] {
  const spy = jest.spyOn(ClientsModule, 'registerAsync');
  RabbitmqClientModule.register(clients);
  const registered = spy.mock.calls[0][0] as unknown as AsyncClient[];
  spy.mockRestore();
  return registered;
}

const config = { get: jest.fn(() => 'amqp://rabbit:5672') } as unknown as ConfigService;

describe('RabbitmqClientModule.register', () => {
  it('returns a dynamic module bound to itself', () => {
    const dynamic = RabbitmqClientModule.register([{ name: 'ORDERS_SERVICE', queue: 'orders_queue' }]);

    expect(dynamic.module).toBe(RabbitmqClientModule);
    expect(dynamic.exports).toContain(ClientsModule);
  });

  it('registers one client per requested queue', () => {
    const registered = registrationsOf([
      { name: 'AUTH_SERVICE', queue: 'auth_queue' },
      { name: 'ORDERS_SERVICE', queue: 'orders_queue' },
    ]);

    expect(registered.map((client) => client.name)).toEqual(['AUTH_SERVICE', 'ORDERS_SERVICE']);
  });

  it('reads the broker url from config at runtime, not at import time', () => {
    const [client] = registrationsOf([{ name: 'AUTH_SERVICE', queue: 'auth_queue' }]);

    expect(client.inject).toEqual([ConfigService]);

    const options = client.useFactory(config);

    expect(config.get).toHaveBeenCalledWith('RABBITMQ_URL');
    expect(options).toMatchObject({
      transport: Transport.RMQ,
      options: { urls: ['amqp://rabbit:5672'], queue: 'auth_queue', persistent: true },
    });
  });

  it('declares each client queue durable, matching the listener side', () => {
    const [client] = registrationsOf([{ name: 'SUPPORT_SERVICE', queue: 'support_queue' }]);

    expect(client.useFactory(config).options.queueOptions).toEqual({ durable: true });
  });

  it('accepts an empty client list', () => {
    expect(registrationsOf([])).toEqual([]);
  });
});
