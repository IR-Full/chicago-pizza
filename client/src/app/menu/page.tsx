import type { Metadata } from 'next';
import { CatalogView } from '@/widgets/catalog/catalog-view';

export const metadata: Metadata = {
  title: 'Меню',
  description: 'Пиццы, закуски, напитки и десерты Chicago Pizza с доставкой по Махачкале.',
};

export default function MenuPage({ searchParams }: { searchParams: { category?: string } }) {
  return <CatalogView initialCategory={searchParams.category} />;
}
