import { OrderStatus } from '@chicago-pizza/prisma';

const BRAND = 'Chicago Pizza';

/**
 * Everything interpolated below is either typed by a customer (their name,
 * a ticket subject) or built from configuration. Pasted raw, a name like
 * `<a href="http://evil">` became a working link inside a message that
 * carries our branding — a phishing page delivered by us, to the person
 * whose address it is. Mail clients do not sanitise; the sender has to.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, body: string): string {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
    <h1 style="font-size:20px;margin:0 0 16px">${BRAND}</h1>
    <h2 style="font-size:17px;margin:0 0 12px">${title}</h2>
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
    <p style="font-size:12px;color:#888;margin:0">${BRAND}, Махачкала. Это письмо отправлено автоматически.</p>
  </div>`;
}

export function verificationEmail(firstName: string, code: string) {
  return {
    subject: `${BRAND} — код подтверждения`,
    html: layout(
      `Здравствуйте, ${escapeHtml(firstName)}!`,
      `<p>Ваш код подтверждения:</p>
       <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
       <p style="font-size:14px;color:#555">Код действителен 15 минут. Если вы не регистрировались — просто проигнорируйте письмо.</p>`,
    ),
  };
}

export function passwordResetEmail(firstName: string, resetUrl: string) {
  return {
    subject: `${BRAND} — восстановление пароля`,
    html: layout(
      `Здравствуйте, ${escapeHtml(firstName)}!`,
      `<p>Вы запросили смену пароля. Перейдите по ссылке, чтобы задать новый:</p>
       <p style="margin:16px 0"><a href="${resetUrl}" style="background:#d32f2f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Сменить пароль</a></p>
       <p style="font-size:14px;color:#555">Ссылка действительна 30 минут. Если вы не запрашивали смену пароля, ничего делать не нужно.</p>`,
    ),
  };
}

const STATUS_TEXT: Record<OrderStatus, string> = {
  CREATED: 'Заказ создан и ожидает подтверждения',
  ACCEPTED: 'Заказ принят — мы начинаем готовить',
  PREPARING: 'Ваша пицца готовится',
  ON_DELIVERY: 'Заказ передан курьеру и уже в пути',
  DELIVERED: 'Заказ доставлен. Приятного аппетита!',
  CANCELLED: 'Заказ отменён',
};

export function orderStatusEmail(firstName: string, orderId: string, status: OrderStatus, orderUrl: string) {
  return {
    subject: `${BRAND} — заказ №${orderId.slice(0, 8).toUpperCase()}: ${STATUS_TEXT[status]}`,
    html: layout(
      `Здравствуйте, ${escapeHtml(firstName)}!`,
      `<p>Статус заказа <strong>№${orderId.slice(0, 8).toUpperCase()}</strong> изменился:</p>
       <p style="font-size:18px;font-weight:600;margin:12px 0">${STATUS_TEXT[status]}</p>
       <p style="margin:16px 0"><a href="${orderUrl}" style="color:#d32f2f">Отследить заказ</a></p>`,
    ),
  };
}

export function supportReplyEmail(firstName: string, ticketSubject: string, ticketUrl: string) {
  return {
    subject: `${BRAND} — новый ответ по обращению «${ticketSubject}»`,
    html: layout(
      `Здравствуйте, ${escapeHtml(firstName)}!`,
      `<p>Служба поддержки ответила на ваше обращение «${escapeHtml(ticketSubject)}».</p>
       <p style="margin:16px 0"><a href="${ticketUrl}" style="color:#d32f2f">Открыть переписку</a></p>`,
    ),
  };
}

/**
 * Sent when someone submits the signup form with an address that already has
 * an account. The form itself answers the same way it answers a fresh signup,
 * so this letter is the only place the truth is told — and it goes to the
 * person who owns the address, not to whoever typed it in.
 */
export function accountExistsEmail(firstName: string, loginUrl: string, resetUrl: string) {
  return {
    subject: `${BRAND} — у вас уже есть аккаунт`,
    html: layout(
      `Здравствуйте, ${escapeHtml(firstName)}!`,
      `<p>Кто-то попытался зарегистрироваться с вашим адресом. Новый аккаунт создан не был —
        у вас уже есть учётная запись.</p>
       <p style="margin:16px 0"><a href="${loginUrl}" style="background:#c1553a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Войти</a></p>
       <p style="font-size:14px;color:#555">Забыли пароль? <a href="${resetUrl}" style="color:#c1553a">Восстановите доступ</a>.
        Если это были не вы, делать ничего не нужно — мы никого не впустили.</p>`,
    ),
  };
}

export function statusLabel(status: OrderStatus): string {
  return STATUS_TEXT[status];
}
