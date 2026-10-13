import { BadRequestException } from '@nestjs/common';

export interface PaymentReceipt {
  customer: { email: string };
  tax_system_code?: number;
  items: {
    description: string;
    quantity: string;
    amount: { value: string; currency: 'RUB' };
    vat_code: number;
    payment_mode: 'full_prepayment';
    payment_subject: 'commodity' | 'service';
  }[];
}

interface ReceiptOrder {
  total: number;
  deliveryFee: number;
  user: { email: string };
  items: {
    productName: string;
    sizeLabel: string | null;
    variantName: string | null;
    quantity: number;
    totalPrice: number;
  }[];
}

/** Allocate discounts in integer kopecks; split quantities when rounding changes unit prices. */
export function buildPaymentReceipt(
  order: ReceiptOrder,
  vatCode: number,
  taxSystemCode?: number,
): PaymentReceipt {
  const foodTotal = order.total - order.deliveryFee;
  const subtotal = order.items.reduce((sum, item) => sum + item.totalPrice, 0);
  if (
    !order.user.email ||
    foodTotal < 0 ||
    foodTotal > subtotal ||
    !subtotal ||
    !Number.isSafeInteger(order.total)
  ) {
    throw new BadRequestException('Не удалось сформировать чек заказа');
  }
  let allocated = 0;
  let cumulative = 0;
  const items: PaymentReceipt['items'] = [];
  function append(
    description: string,
    quantity: number,
    unitAmount: number,
    subject: 'commodity' | 'service',
  ) {
    if (!quantity || !unitAmount) return;
    items.push({
      description: description.slice(0, 128),
      quantity: quantity.toFixed(3),
      amount: { value: (unitAmount / 100).toFixed(2), currency: 'RUB' },
      vat_code: vatCode,
      payment_mode: 'full_prepayment',
      payment_subject: subject,
    });
  }
  for (const item of order.items) {
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isSafeInteger(item.totalPrice) ||
      item.totalPrice < 0
    ) {
      throw new BadRequestException('Некорректные позиции чека');
    }
    cumulative += item.totalPrice;
    const next = Number((BigInt(foodTotal) * BigInt(cumulative)) / BigInt(subtotal));
    const lineAmount = next - allocated;
    allocated = next;
    const unitAmount = Math.floor(lineAmount / item.quantity);
    const remainder = lineAmount % item.quantity;
    const description = [item.productName, item.variantName, item.sizeLabel].filter(Boolean).join(' · ');
    append(description, item.quantity - remainder, unitAmount, 'commodity');
    append(description, remainder, unitAmount + 1, 'commodity');
  }
  append('Доставка', 1, order.deliveryFee, 'service');
  if (!items.length || items.length > 100)
    throw new BadRequestException('Некорректное количество позиций чека');
  return {
    customer: { email: order.user.email },
    ...(taxSystemCode ? { tax_system_code: taxSystemCode } : {}),
    items,
  };
}
