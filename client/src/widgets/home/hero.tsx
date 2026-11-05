import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ProductImage } from '@/shared/ui/product-image';
import styles from './home.module.css';

export async function Hero({ sizes }: { sizes: number[] }) {
  const t = await getTranslations('home');

  return (
    <section className={styles.poster} aria-labelledby="home-poster-title">
      <div className={`container ${styles.posterInner}`}>
        <h1 id="home-poster-title" className={styles.posterTitle}>
          <span>{t('heroTitleTop')}</span> <span>{t('heroTitleBottom')}</span>{' '}
          <span className={styles.posterTagline}>{t('heroTagline')}</span>
        </h1>
        <p className={styles.posterLocation}>{t('heroLocation')}</p>

        <div className={styles.posterActions}>
          <Link href="/menu" className={styles.posterOrder}>
            {t('orderNow')}
            <ArrowRight aria-hidden className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
          </Link>
          {sizes.length > 0 && (
            <a
              href="#sizes"
              className={styles.posterSizes}
              aria-label={t('compareSizes')}
              aria-describedby="home-poster-diameters"
            >
              <span>{t('heroSizesLabel')}</span>
              <strong id="home-poster-diameters">{`${sizes.join(' / ')} ${t('cm')}`}</strong>
            </a>
          )}
        </div>
      </div>

      <figure className={styles.posterPizza}>
        <ProductImage
          src="/menu/assorti-340.webp"
          alt={t('heroImageAlt')}
          sizes="(min-width: 1650px) 1000px, (min-width: 900px) 61vw, (min-width: 600px) 672px, 112vw"
          className="object-contain"
          priority
        />
      </figure>
    </section>
  );
}
