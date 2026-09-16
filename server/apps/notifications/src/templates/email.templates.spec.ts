import {
  orderStatusEmail,
  passwordResetEmail,
  statusLabel,
  supportReplyEmail,
  verificationEmail,
} from './email.templates';

/** Emails are the only place the product speaks to a customer outside the app. */
describe('verificationEmail', () => {
  const mail = verificationEmail('Амина', '424242');

  it('names the brand in the subject', () => {
    expect(mail.subject).toContain('Chicago Pizza');
  });

  it('greets the customer and shows the code', () => {
    expect(mail.html).toContain('Амина');
    expect(mail.html).toContain('424242');
  });

  it('states how long the code lives', () => {
    expect(mail.html).toContain('15 минут');
  });
});

describe('passwordResetEmail', () => {
  const mail = passwordResetEmail('Амина', 'https://chicago-pizza.ru/reset-password?token=abc');

  it('links to the reset page', () => {
    expect(mail.html).toContain('href="https://chicago-pizza.ru/reset-password?token=abc"');
  });

  it('reassures a customer who did not ask for it', () => {
    expect(mail.html).toContain('ничего делать не нужно');
  });
});

describe('orderStatusEmail', () => {
  it.each([
    ['CREATED', 'Заказ создан и ожидает подтверждения'],
    ['ACCEPTED', 'Заказ принят — мы начинаем готовить'],
    ['PREPARING', 'Ваша пицца готовится'],
    ['ON_DELIVERY', 'Заказ передан курьеру и уже в пути'],
    ['DELIVERED', 'Заказ доставлен. Приятного аппетита!'],
    ['CANCELLED', 'Заказ отменён'],
  ])('describes %s as %p', (status, text) => {
    const mail = orderStatusEmail('Амина', 'abcdef12-3456-7890', status as never, 'https://chicago-pizza.ru/orders/1');

    expect(mail.subject).toContain(text);
    expect(mail.html).toContain(text);
  });

  it('shows the short order number in both subject and body', () => {
    const mail = orderStatusEmail('Амина', 'abcdef12-3456-7890', 'PREPARING' as never, 'https://x/1');

    expect(mail.subject).toContain('ABCDEF12');
    expect(mail.html).toContain('ABCDEF12');
  });

  it('links to the tracking page', () => {
    const mail = orderStatusEmail('Амина', 'order-1', 'ON_DELIVERY' as never, 'https://chicago-pizza.ru/orders/order-1');

    expect(mail.html).toContain('href="https://chicago-pizza.ru/orders/order-1"');
  });
});

describe('supportReplyEmail', () => {
  const mail = supportReplyEmail('Амина', 'Холодная пицца', 'https://chicago-pizza.ru/support/t1');

  it('quotes the ticket subject', () => {
    expect(mail.subject).toContain('Холодная пицца');
    expect(mail.html).toContain('Холодная пицца');
  });

  it('links to the conversation', () => {
    expect(mail.html).toContain('href="https://chicago-pizza.ru/support/t1"');
  });
});

describe('statusLabel', () => {
  it('returns the same wording the emails use', () => {
    expect(statusLabel('DELIVERED' as never)).toBe('Заказ доставлен. Приятного аппетита!');
  });

  it('covers every order status', () => {
    for (const status of ['CREATED', 'ACCEPTED', 'PREPARING', 'ON_DELIVERY', 'DELIVERED', 'CANCELLED']) {
      expect(statusLabel(status as never)).toEqual(expect.any(String));
    }
  });
});

describe('layout', () => {
  it('closes every email with the legal footer', () => {
    for (const mail of [
      verificationEmail('Амина', '111111'),
      passwordResetEmail('Амина', 'https://x'),
      orderStatusEmail('Амина', 'order-1', 'CREATED' as never, 'https://x'),
      supportReplyEmail('Амина', 'Тема', 'https://x'),
    ]) {
      expect(mail.html).toContain('Это письмо отправлено автоматически');
      expect(mail.html).toContain('Махачкала');
    }
  });
});
