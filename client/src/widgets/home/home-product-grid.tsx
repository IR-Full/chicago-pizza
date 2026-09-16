'use client';

import { useState } from 'react';
import type { Product } from '@/shared/api/types';
import { ProductCard } from '@/entities/product/ui/product-card';
import { PizzaConstructorDialog } from '@/features/pizza-constructor/ui/pizza-constructor-dialog';

/**
 * Client island inside the server-rendered home page: the cards themselves
 * come from the server, only the constructor dialog needs interactivity.
 */
export function HomeProductGrid({ products }: { products: Product[] }) {
  const [selected, setSelected] = useState<Product | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-[clamp(1rem,2vw,1.625rem)] lg:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} onSelect={setSelected} />
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
