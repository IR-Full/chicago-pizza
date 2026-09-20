import { getTranslations } from 'next-intl/server';
import type { RecentReview } from '@/shared/api/types';

/**
 * Real reviews of delivered orders. A review rates the order, not a single
 * product, so the caption names the items that were in it.
 */
export async function Reviews({ reviews }: { reviews: RecentReview[] }) {
  const t = await getTranslations('home');
  if (!reviews.length) return null;

  return (
    <section className="container py-[clamp(2rem,5vw,4.5rem)]">
      <span className="section-kicker">{t('reviewsKicker')}</span>

      <div className="mt-[clamp(1.375rem,3vw,2.5rem)] grid gap-[clamp(1.25rem,3vw,2.75rem)] sm:grid-cols-2 lg:grid-cols-3">
        {reviews.map((review) => (
          <figure key={review.id} className="m-0">
            <blockquote className="m-0 font-heading text-[clamp(1.25rem,1.9vw,1.5625rem)] font-black leading-[1.35]">
              {review.comment}
            </blockquote>
            <figcaption className="mt-4 text-[14.5px] text-foreground/70">
              <span aria-label={`${review.rating} / 5`} className="text-brand-600">
                {'★'.repeat(review.rating)}
                <span className="text-foreground/25">{'★'.repeat(Math.max(0, 5 - review.rating))}</span>
              </span>{' '}
              · {review.authorName}
              {review.items.length ? ` · ${review.items.slice(0, 2).join(', ')}` : ''}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
