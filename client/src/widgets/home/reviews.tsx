import { getTranslations } from 'next-intl/server';

export interface HomeReview {
  comment: string;
  rating: number;
  productName: string;
}

/** Real order reviews pulled from the catalog — the section hides when there are none. */
export async function Reviews({ reviews }: { reviews: HomeReview[] }) {
  const t = await getTranslations('home');
  if (!reviews.length) return null;

  return (
    <section className="container py-[clamp(2rem,5vw,4.5rem)]">
      <span className="section-kicker">{t('reviewsKicker')}</span>

      <div className="mt-[clamp(1.375rem,3vw,2.5rem)] grid gap-[clamp(1.25rem,3vw,2.75rem)] sm:grid-cols-2 lg:grid-cols-3">
        {reviews.map((review, index) => (
          <figure key={`${review.productName}-${index}`} className="m-0">
            <blockquote className="m-0 font-heading text-[clamp(1.25rem,1.9vw,1.5625rem)] font-black leading-[1.35]">
              {review.comment}
            </blockquote>
            <figcaption className="mt-4 text-[14.5px] text-foreground/70">
              <span aria-label={`${review.rating} / 5`} className="text-brand-600">
                {'★'.repeat(review.rating)}
                <span className="text-foreground/25">{'★'.repeat(Math.max(0, 5 - review.rating))}</span>
              </span>{' '}
              · {review.productName}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
