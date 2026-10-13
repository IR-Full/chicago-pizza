// CI-only integration checks against an isolated migrated PostgreSQL database.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PaymentService } = require('../apps/orders/dist/services/payment.service');
const { NotificationService } = require('../apps/notifications/dist/services/notification.service');
if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Use an isolated *_test database');
const db = new PrismaClient();
(async () => {
  const user = await db.user.create({
    data: {
      email: `${randomUUID()}@example.invalid`,
      firstName: 'CI',
      passwordHash: 'not-a-login',
      referralCode: randomUUID(),
      isEmailVerified: true,
    },
  });
  const data = { userId: user.id, subtotal: 10000, total: 10000, paymentMethod: 'ONLINE' };
  const key = randomUUID();
  const createOnce = () =>
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${user.id + ':' + key}, 0))`;
      return (
        (await tx.order.findFirst({ where: { userId: user.id, idempotencyKey: key } })) ??
        tx.order.create({ data: { ...data, idempotencyKey: key } })
      );
    });
  const pair = await Promise.all([createOnce(), createOnce()]);
  assert.equal(pair[0].id, pair[1].id, 'Concurrent checkout must produce one order');
  await assert.rejects(
    db.order.create({ data: { ...data, idempotencyKey: key } }),
    (error) => error.code === 'P2002',
  );

  const before = await db.eventOutbox.count();
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.eventOutbox.create({
        data: { event: 'rollback-test', destination: 'notifications', payload: {} },
      });
      throw new Error('rollback');
    }),
  );
  assert.equal(await db.eventOutbox.count(), before, 'Rolled back events must not escape');

  let refundState = 'pending';
  const provider = {
    fetch: async (id) => ({
      providerPaymentId: id,
      status: 'succeeded',
      paid: true,
      currency: 'RUB',
      amount: 10000,
    }),
    refund: async ({ orderId }) => ({
      providerRefundId: `refund-${orderId}`,
      status: refundState,
      amount: 10000,
    }),
    fetchRefund: async (id) => ({ providerRefundId: id, status: refundState, amount: 10000 }),
  };
  const service = new PaymentService(db, { get: () => 'https://example.invalid' }, provider, {}, {});
  const cancelled = await db.order.create({ data: { ...data, status: 'CANCELLED' } });
  const payment = await db.payment.create({
    data: { orderId: cancelled.id, provider: 'test', providerPaymentId: randomUUID(), amount: 10000 },
  });
  await service.handleNotification(payment.providerPaymentId);
  assert.equal((await db.order.findUnique({ where: { id: cancelled.id } })).status, 'CANCELLED');
  assert.equal(
    await db.orderStatusHistory.count({ where: { orderId: cancelled.id, status: 'ACCEPTED' } }),
    0,
  );
  assert.equal(
    (await db.payment.findUnique({ where: { id: payment.id } })).status,
    'SUCCEEDED',
    'Pending refund is not refunded',
  );
  refundState = 'succeeded';
  await service.refundForCancelledOrder(cancelled.id);
  assert.equal((await db.payment.findUnique({ where: { id: payment.id } })).status, 'REFUNDED');

  const live = await db.order.create({ data });
  const livePayment = await db.payment.create({
    data: { orderId: live.id, provider: 'test', providerPaymentId: randomUUID(), amount: 10000 },
  });
  await service.handleNotification(livePayment.providerPaymentId);
  await service.handleNotification(livePayment.providerPaymentId);
  assert.equal((await db.order.findUnique({ where: { id: live.id } })).status, 'ACCEPTED');
  assert.equal(await db.orderStatusHistory.count({ where: { orderId: live.id, status: 'ACCEPTED' } }), 1);
  assert.equal(await db.eventOutbox.count({ where: { payload: { path: ['orderId'], equals: live.id } } }), 2);
  const eventId = randomUUID();
  let pushes = 0;
  const mailKeys = new Set();
  const notices = new NotificationService(
    db,
    { get: () => 'https://example.invalid' },
    {
      sendToUser: async () => {
        pushes++;
      },
    },
    {
      add: async (_name, _payload, options) => {
        mailKeys.add(options.jobId);
      },
    },
  );
  const notify = () =>
    notices.handleOrderStatusChanged({ eventId, userId: user.id, orderId: live.id, status: 'CREATED' });
  await Promise.all(Array.from({ length: 10 }, notify));
  assert.equal(pushes, 1, 'Repeated delivery must not repeat browser pushes');
  assert.equal(mailKeys.size, 1, 'Repeated delivery must reuse the email job key');
  assert.equal(
    await db.notification.count({ where: { eventId } }),
    1,
    'Repeated delivery must not duplicate notification rows',
  );
  console.log(
    'PostgreSQL invariants verified: uniqueness, serialization, rollback, late payment, refund, duplicate webhook',
  );
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
