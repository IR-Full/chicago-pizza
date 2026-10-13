import { of, throwError } from 'rxjs';
import { OutboxService } from './outbox.service';

function harness(fails = false, older = false) {
  const row = {
    id: 'event-1',
    event: 'order.created',
    payload: { orderId: 'order-1' },
    destination: 'notifications',
    sequence: 1n,
    attempts: 0,
  };
  const prisma = {
    eventOutbox: {
      findMany: jest.fn(async () => [row]),
      findFirst: jest.fn(async () => (older ? row : null)),
      updateMany: jest.fn(async () => ({ count: 1 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  const client = {
    send: jest.fn(() => (fails ? throwError(() => new Error('broker unavailable')) : of({ received: true }))),
  };
  return { service: new OutboxService(prisma as never, client as never, client as never), prisma, client };
}

describe('durable outbox delivery', () => {
  it('marks delivered only after the consumer responds', async () => {
    const { service, prisma, client } = harness();
    await service.deliver();
    expect(client.send).toHaveBeenCalledWith('order.created', { orderId: 'order-1', eventId: 'event-1' });
    expect(prisma.eventOutbox.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deliveredAt: expect.any(Date) }) }),
    );
  });
  it('retains failed delivery and schedules another attempt', async () => {
    const { service, prisma } = harness(true);
    await service.deliver();
    expect(prisma.eventOutbox.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nextAttemptAt: expect.any(Date), lastError: expect.any(String) }),
      }),
    );
    expect(prisma.eventOutbox.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deliveredAt: { lt: expect.any(Date) } } }),
    );
  });
  it('does not overtake a pending earlier event for the same order', async () => {
    const { service, client } = harness(false, true);
    await service.deliver();
    expect(client.send).not.toHaveBeenCalled();
  });
});
