import { Test } from '@nestjs/testing';
import { HealthModule } from './health.module';
import { HealthController } from './health.controller';

// PrismaService is provided by the app that imports HealthModule, so the
// module alone cannot resolve it — auto-mocking stands in for the host app.
const compile = () =>
  Test.createTestingModule({ imports: [HealthModule] })
    .useMocker(() => ({}))
    .compile();

describe('HealthModule', () => {
  it('wires the controller with terminus and the database indicator', async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(HealthController)).toBeInstanceOf(HealthController);
  });

  it('answers liveness through the compiled controller', async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(HealthController).liveness()).toEqual({ status: 'ok' });
  });
});
