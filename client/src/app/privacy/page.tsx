import type { Metadata } from 'next';
import { PRIVACY_POLICY_VERSION } from '@/shared/config/legal';

export const metadata: Metadata = {
  title: 'Политика обработки персональных данных',
  description:
    'Какие персональные данные собирает Chicago Pizza, зачем, как долго хранит и как их удалить.',
};

/**
 * The document the signup checkbox points at.
 *
 * It is a page rather than a PDF on purpose: `PRIVACY_POLICY_VERSION` is
 * rendered into it, so what a customer agreed to can be matched against what
 * is stored on their account. Changing the text means bumping that constant —
 * see `shared/config/legal.ts`.
 */
export default function PrivacyPage() {
  return (
    <div className="container max-w-3xl space-y-8 py-12">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-black">Политика обработки персональных данных</h1>
        <p className="text-sm text-muted-foreground">
          Редакция от {PRIVACY_POLICY_VERSION}. Документ составлен в соответствии с Федеральным законом
          от 27.07.2006 № 152-ФЗ «О персональных данных».
        </p>
      </header>

      <Section title="1. Кто обрабатывает данные">
        <p>
          Оператор — сеть пиццерий «Chicago Pizza», г. Махачкала. Вопросы по обработке персональных
          данных и отзыв согласия — через форму поддержки в личном кабинете или по адресу{' '}
          <a className="text-primary hover:underline" href="mailto:privacy@chicago-pizza.ru">
            privacy@chicago-pizza.ru
          </a>
          .
        </p>
      </Section>

      <Section title="2. Какие данные мы собираем">
        <ul className="list-disc space-y-1 pl-5">
          <li>Имя и фамилия — чтобы обратиться к вам и передать заказ курьеру.</li>
          <li>Адрес электронной почты — вход в аккаунт, письма о статусе заказа, восстановление пароля.</li>
          <li>Телефон (по желанию) — связь курьера с вами.</li>
          <li>Адреса доставки — доставка заказа.</li>
          <li>История заказов, отзывы, баллы лояльности — работа программы лояльности и бухгалтерия.</li>
          <li>Переписка со службой поддержки.</li>
          <li>
            IP-адрес и сведения о браузере при входе — защита аккаунта: по ним вы видите свои активные
            сессии и можете завершить чужую.
          </li>
        </ul>
        <p>
          Мы не собираем данные специальных категорий, не используем рекламные трекеры и не передаём
          данные третьим лицам для маркетинга.
        </p>
      </Section>

      <Section title="3. Зачем и на каком основании">
        <p>
          Данные обрабатываются для исполнения договора (доставка заказа), на основании вашего согласия,
          данного при регистрации, и для исполнения требований законодательства о бухгалтерском учёте.
        </p>
      </Section>

      <Section title="4. Сколько храним">
        <ul className="list-disc space-y-1 pl-5">
          <li>Профиль и адреса — пока существует аккаунт.</li>
          <li>Заказы — 5 лет, как того требуют правила бухгалтерского учёта, в обезличенном виде после удаления аккаунта.</li>
          <li>Токены сессий, коды подтверждения и ссылки восстановления — 30 дней после истечения срока.</li>
        </ul>
      </Section>

      <Section title="5. Куки">
        <p>
          Сайт использует только технически необходимые куки: сессионные куки аутентификации (
          <code className="rounded bg-muted px-1">access_token</code>,{' '}
          <code className="rounded bg-muted px-1">refresh_token</code>) и куки выбранного языка. Они
          помечены <code className="rounded bg-muted px-1">httpOnly</code> и недоступны JavaScript.
          Аналитических и рекламных куки нет.
        </p>
      </Section>

      <Section title="6. Ваши права">
        <ul className="list-disc space-y-1 pl-5">
          <li>Получить копию своих данных — «Профиль» → «Скачать мои данные» (файл JSON).</li>
          <li>Исправить данные — в профиле.</li>
          <li>
            Отозвать согласие и удалить аккаунт — «Профиль» → «Удалить аккаунт». Персональные данные
            стираются сразу; заказы остаются в обезличенном виде для бухгалтерии.
          </li>
          <li>Посмотреть и завершить активные сессии — «Профиль» → «Активные сессии».</li>
        </ul>
      </Section>

      <Section title="7. Как мы защищаем данные">
        <p>
          Пароли хранятся в виде хешей bcrypt, токены сессий — в виде хешей SHA-256. Доступ к данным
          ограничен ролями; действия администраторов фиксируются в журнале. Передача данных между
          браузером и сервером защищена TLS.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-xl font-bold">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}
