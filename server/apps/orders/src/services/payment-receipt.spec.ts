import { buildPaymentReceipt } from './payment-receipt';

const order = {
  total: 10501,
  deliveryFee: 1500,
  user: { email: 'buyer@example.ru' },
  items: [
    { productName: 'Пицца', sizeLabel: '45 см', variantName: null, quantity: 3, totalPrice: 9000 },
    { productName: 'Kinza', sizeLabel: null, variantName: 'Цитрус', quantity: 2, totalPrice: 4000 },
  ],
};
const sum = (receipt: ReturnType<typeof buildPaymentReceipt>) =>
  receipt.items.reduce(
    (value, item) => value + Math.round(Number(item.amount.value) * 100) * Number(item.quantity),
    0,
  );

describe('payment receipt', () => {
  it('matches the charged amount down to a kopeck after discounts and includes delivery', () => {
    const receipt = buildPaymentReceipt(order, 1, 2);
    expect(sum(receipt)).toBe(order.total);
    expect(receipt.customer.email).toBe('buyer@example.ru');
    expect(receipt.tax_system_code).toBe(2);
    expect(receipt.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'Kinza · Цитрус' }),
        expect.objectContaining({
          description: 'Доставка',
          payment_subject: 'service',
          amount: { value: '15.00', currency: 'RUB' },
        }),
      ]),
    );
    expect(receipt.items.every((item) => item.payment_mode === 'full_prepayment')).toBe(true);
  });
  it('balances a wide range of discounts and never sends a zero-price row', () => {
    for (let total = 1501; total <= 14500; total += 37) {
      const receipt = buildPaymentReceipt({ ...order, total }, 11);
      expect(sum(receipt)).toBe(total);
      expect(receipt.items.every((item) => Number(item.amount.value) > 0)).toBe(true);
    }
  });
  it('can charge only delivery when loyalty pays for all food', () => {
    const receipt = buildPaymentReceipt({ ...order, total: 1500 }, 1);
    expect(receipt.items).toHaveLength(1);
    expect(sum(receipt)).toBe(1500);
  });
  it('refuses invalid totals and quantities', () => {
    expect(() => buildPaymentReceipt({ ...order, total: 14501 }, 1)).toThrow();
    expect(() => buildPaymentReceipt({ ...order, items: [{ ...order.items[0], quantity: 0 }] }, 1)).toThrow();
  });
});
