import type { Metadata } from 'next';
import Link from 'next/link';
import { CLOSING_HOUR, DELIVERY_FEE_KOPECKS, FREE_DELIVERY_THRESHOLD_KOPECKS, OPENING_HOUR } from '@/shared/config/delivery';

export const metadata: Metadata = {
  title: 'Условия сервиса',
  description: 'Правила заказа, доставки, оплаты и возврата в Chicago Pizza.',
};

export default function TermsPage() {
  const deliveryFee = DELIVERY_FEE_KOPECKS / 100;
  const freeFrom = FREE_DELIVERY_THRESHOLD_KOPECKS / 100;

  return (
    <div className="container max-w-3xl space-y-8 py-12">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-black">Условия сервиса</h1>
        <p className="text-sm text-muted-foreground">
          Оформляя заказ, вы соглашаетесь с правилами ниже. Обработка персональных данных описана
          отдельно — в{' '}
          <Link href="/privacy" className="text-primary hover:underline">
            политике конфиденциальности
          </Link>
          .
        </p>
      </header>

      <Section title="1. Заказ">
        <p>
          Заказ оформляется через сайт после подтверждения адреса электронной почты. Итоговая сумма
          всегда рассчитывается на сервере по актуальному меню — цена, показанная в корзине, может
          измениться, если товар сняли с продажи до оформления; в этом случае мы сообщим об этом до
          оплаты.
        </p>
      </Section>

      <Section title="2. Доставка">
        <ul className="list-disc space-y-1 pl-5">
          <li>Доставка по Махачкале с {OPENING_HOUR}:00 до {CLOSING_HOUR}:00.</li>
          <li>Стоимость доставки — {deliveryFee} ₽; от {freeFrom} ₽ доставка бесплатная.</li>
          <li>Доставку «ко времени» можно заказать не менее чем за 30 минут и в рабочие часы.</li>
        </ul>
      </Section>

      <Section title="3. Оплата">
        <p>
          Оплата наличными или картой курьеру при получении. Онлайн-оплата пока не подключена, данные
          банковских карт сайт не собирает и не хранит.
        </p>
      </Section>

      <Section title="4. Отмена и возврат">
        <p>
          Заказ можно отменить до передачи курьеру — напишите в поддержку. Если заказ приехал
          повреждённым или не тем, что заказывали, сообщите в течение суток: мы заменим блюдо или
          вернём деньги.
        </p>
      </Section>

      <Section title="5. Баллы и промокоды">
        <p>
          Баллы начисляются после доставки заказа и списываются при следующем. Промокод действует в
          рамках ограничений, указанных при его выдаче; один заказ — один промокод.
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
