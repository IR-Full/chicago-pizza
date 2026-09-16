import { DynamicModule, Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';

/**
 * Registers a `ClientProxy` (injectable via `@Inject(token)`) for each queue
 * a consumer service needs to call. Usage:
 *
 *   RabbitmqClientModule.register([{ name: 'PRODUCTS_SERVICE', queue: RMQ_QUEUES.PRODUCTS }])
 */
@Module({})
export class RabbitmqClientModule {
  static register(clients: { name: string; queue: string }[]): DynamicModule {
    return {
      module: RabbitmqClientModule,
      imports: [
        ClientsModule.registerAsync(
          clients.map(({ name, queue }) => ({
            name,
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
              transport: Transport.RMQ,
              options: {
                urls: [config.get<string>('RABBITMQ_URL')!],
                queue,
                queueOptions: { durable: true },
                persistent: true,
              },
            }),
          })),
        ),
      ],
      exports: [ClientsModule],
    };
  }
}
