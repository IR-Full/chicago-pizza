import { YooKassaProvider } from './yookassa.provider';

describe('YooKassa card API', () => {
  const create = {
    orderId: 'order-1',
    amount: 13001,
    description: 'Заказ',
    returnUrl: 'https://pizza.example.ru/orders/order-1',
  };
  const config = {
    get: (name: string) => ({ YOOKASSA_SHOP_ID: '123', YOOKASSA_SECRET_KEY: 'test_key' })[name],
  };
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;
  beforeEach(() => {
    fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'payment-1',
        confirmation: { confirmation_url: 'https://yoomoney.ru/checkout' },
      }),
    }));
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('charges in RUB on the provider bank-card page with an idempotent key', async () => {
    const provider = new YooKassaProvider(config as never);
    await provider.create(create);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.yookassa.ru/v3/payments');
    expect(request.headers['Idempotence-Key']).toBe('order-1');
    expect(JSON.parse(request.body)).toMatchObject({
      amount: { value: '130.01', currency: 'RUB' },
      payment_method_data: { type: 'bank_card' },
      capture: true,
      confirmation: { type: 'redirect', return_url: create.returnUrl },
    });
  });
  it('forwards receipts on payments and full refunds', async () => {
    const provider = new YooKassaProvider(config as never);
    const receipt = { customer: { email: 'buyer@example.ru' }, items: [] };
    await provider.create({ ...create, receipt, idempotenceKey: 'retry-key' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).receipt).toEqual(receipt);
    expect(fetchMock.mock.calls[0][1].headers['Idempotence-Key']).toBe('retry-key');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'refund-1', status: 'succeeded', amount: { value: '130.01' } }),
    });
    await provider.refund({ providerPaymentId: 'payment-1', orderId: 'order-1', amount: 13001, receipt });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).receipt).toEqual(receipt);
  });
  it('does not call the provider without merchant credentials', async () => {
    const provider = new YooKassaProvider({ get: () => '' } as never);
    await expect(provider.create(create)).rejects.toThrow('Онлайн-оплата не настроена');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not expose a provider error to customers', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(new YooKassaProvider(config as never).create(create)).rejects.toThrow(
      'Платёжный сервис недоступен',
    );
  });
});
