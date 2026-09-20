import { AdminAction } from '@chicago-pizza/prisma';
import { AuditService } from './audit.service';

function createService(create: jest.Mock = jest.fn(async () => ({ id: 'audit-1' }))) {
  const prisma: Record<string, any> = { adminAuditLog: { create } };
  return { service: new AuditService(prisma as never), create };
}

/**
 * Order status history was the only trail the system kept, so "why is this
 * customer suddenly an administrator" and "who blocked that account" had no
 * answer at all — not months later, and not the same afternoon.
 */
describe('AuditService', () => {
  it('writes who did what to whom', async () => {
    const { service, create } = createService();

    await service.record({
      action: AdminAction.USER_ROLE_CHANGED,
      actorId: 'admin-1',
      targetType: 'user',
      targetId: 'user-9',
      details: { from: 'USER', to: 'ADMIN' },
      ip: '10.0.0.1',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        action: AdminAction.USER_ROLE_CHANGED,
        actorId: 'admin-1',
        targetType: 'user',
        targetId: 'user-9',
        details: { from: 'USER', to: 'ADMIN' },
        ip: '10.0.0.1',
      },
    });
  });

  it('accepts a null actor for something the system or the customer did', async () => {
    const { service, create } = createService();

    await service.record({
      action: AdminAction.ACCOUNT_ERASED,
      actorId: null,
      targetType: 'user',
      targetId: 'user-9',
    });

    expect(create.mock.calls[0][0].data.actorId).toBeNull();
  });

  /**
   * An audit write that could fail the action it describes would be a new way
   * to break the admin panel. A missing line is a smaller problem than a
   * blocked customer nobody can unblock.
   */
  it('never lets a failed write break the action it was recording', async () => {
    const { service } = createService(
      jest.fn(async () => {
        throw new Error('database is on fire');
      }),
    );

    await expect(
      service.record({
        action: AdminAction.USER_BLOCKED,
        actorId: 'admin-1',
        targetType: 'user',
        targetId: 'user-9',
      }),
    ).resolves.toBeUndefined();
  });
});
