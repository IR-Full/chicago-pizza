'use client';

import { useState } from 'react';
import type { Product } from '@/shared/api/types';
import { ProductCard } from '@/entities/product/ui/product-card';
import { PizzaConstructorDialog } from '@/features/pizza-constructor/ui/pizza-constructor-dialog';
import styles from './home.module.css';

/**
 * Client island inside the server-rendered home page: the cards themselves
 * come from the server, only the constructor dialog needs interactivity.
 */
export function HomeProductGrid({ products }: { products: Product[] }) {
  const [selected, setSelected] = useState<Product | null>(null);

  return (
    <>
      <div className={styles.productGrid}>
        {products.map((product) => (
          <div key={product.id} className={styles.productSlot}>
            <ProductCard product={product} onSelect={setSelected} mobileRow />
          </div>
        ))}
      </div>

      <PizzaConstructorDialog
        product={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
