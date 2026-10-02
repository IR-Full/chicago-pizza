import webpush from 'web-push';
import { PushService } from './push.service';

jest.mock('web-push', () => ({
  __esModule: true,
  default: { setVapidDetails: jest.fn(), sendNotification: jest.fn(async () => undefined) },
}));

const sendNotification = webpush.sendNotification as jest.Mock;
const setVapidDetails = webpush.setVapidDetails as jest.Mock;

function createService(env: Record<string, string | undefined> = {}) {
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          VAPID_PUBLIC_KEY: 'BPublicKey',
          VAPID_PRIVATE_KEY: 'PrivateKey',
          VAPID_SUBJECT: 'mailto:admin@chicago-pizza.ru',
          ...env,
        })[key],
    ),
  };

  const prisma = {
    pushSubscription: {
      findMany: jest.fn(async () => [
        { endpoint: 'https://push.example/phone', keys: { p256dh: 'p', auth: 'a' } },
      ]),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };

  const service = new PushService(prisma as never, config as never);
  service.onModuleInit();

  return { service, prisma, config };
}

const PAYLOAD = { title: 'Заказ №A1B2C3D4', body: 'Передан курьеру', url: '/orders/order-1' };

beforeEach(() => {
  jest.clearAllMocks();
  sendNotification.mockResolvedValue(undefined);
});

describe('PushService — configuration', () => {
  it('registers the VAPID pair and reports the public key', () => {
    const { service } = createService();

    expect(setVapidDetails).toHaveBeenCalledWith('mailto:admin@chicago-pizza.ru', 'BPublicKey', 'PrivateKey');
    expect(service.applicationServerKey).toBe('BPublicKey');
    expect(service.isEnabled).toBe(true);
  });

  /**
   * A shop that has not generated a VAPID pair must still boot and still send
   * emails. Optional beats a startup crash over a nice-to-have.
   */
  it.each([['VAPID_PUBLIC_KEY'], ['VAPID_PRIVATE_KEY']])('stays off without %s', (missing) => {
    const { service } = createService({ [missing]: undefined });

    expect(service.isEnabled).toBe(false);
    expect(service.applicationServerKey).toBeNull();
    expect(setVapidDetails).not.toHaveBeenCalled();
  });

  it('does not even look for subscriptions while switched off', async () => {
    const { service, prisma } = createService({ VAPID_PUBLIC_KEY: undefined });

    await expect(service.sendToUser('user-1', PAYLOAD)).resolves.toEqual({ sent: 0 });
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
  });
});

describe('PushService — sending', () => {
  it('pushes the payload to the customer’s device', async () => {
    const { service } = createService();

    await expect(service.sendToUser('user-1', PAYLOAD)).resolves.toEqual({ sent: 1 });

    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.example/phone', keys: { p256dh: 'p', auth: 'a' } },
      JSON.stringify(PAYLOAD),
    );
  });

  it('does nothing for a customer who never subscribed', async () => {
    const { service, prisma } = createService();
    prisma.pushSubscription.findMany.mockResolvedValue([]);

    await expect(service.sendToUser('user-1', PAYLOAD)).resolves.toEqual({ sent: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('reaches the live device even when another subscription is dead', async () => {
    const { service, prisma } = createService();
    prisma.pushSubscription.findMany.mockResolvedValue([
      { endpoint: 'https://push.example/old-desktop', keys: { p256dh: 'p', auth: 'a' } },
      { endpoint: 'https://push.example/phone', keys: { p256dh: 'p', auth: 'a' } },
    ]);
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }))
      .mockResolvedValueOnce(undefined);

    // One stale desktop subscription must not silence the phone in a pocket.
    await expect(service.sendToUser('user-1', PAYLOAD)).resolves.toEqual({ sent: 1 });
  });
});

describe('PushService — housekeeping', () => {
  it.each([[404], [410]])('forgets a subscription the push service reports gone (%s)', async (status) => {
    const { service, prisma } = createService();
    sendNotification.mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: status }));

    await service.sendToUser('user-1', PAYLOAD);

    // Left in place these pile up forever, and every later send pays for them.
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: { in: ['https://push.example/phone'] } },
    });
  });

  it('keeps a subscription that merely failed this time', async () => {
    const { service, prisma } = createService();
    sendNotification.mockRejectedValue(Object.assign(new Error('Service Unavailable'), { statusCode: 503 }));

    await expect(service.sendToUser('user-1', PAYLOAD)).resolves.toEqual({ sent: 0 });
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('never throws at the caller — the row and the email are the record', async () => {
    const { service } = createService();
    sendNotification.mockRejectedValue(new Error('network down'));

    await expect(service.sendToUser('user-1', PAYLOAD)).resolves.toEqual({ sent: 0 });
  });
});
