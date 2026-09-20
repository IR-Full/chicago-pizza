import type { Metadata } from 'next';
import { CatalogView } from '@/widgets/catalog/catalog-view';

export const metadata: Metadata = {
  title: 'Меню',
  description: 'Пиццы, закуски, напитки и десерты Chicago Pizza с доставкой по Махачкале.',
};

// Next 15 hands `searchParams` in as a promise, so the page awaits it.
export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  return <CatalogView initialCategory={category} />;
}
