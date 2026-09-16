'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/api-client';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Textarea } from '@/shared/ui/textarea';
import { useSubmitReview } from '@/entities/order/queries';

interface OrderReviewFormProps {
  orderId: string;
  existingReview: { rating: number; comment: string | null } | null;
}

export function OrderReviewForm({ orderId, existingReview }: OrderReviewFormProps) {
  const t = useTranslations('orders');
  const submitReview = useSubmitReview();

  const [rating, setRating] = useState(existingReview?.rating ?? 0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState(existingReview?.comment ?? '');

  async function submit() {
    if (rating < 1) return;
    try {
      await submitReview.mutateAsync({ id: orderId, rating, comment: comment || undefined });
      toast.success(t('reviewThanks'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось отправить отзыв');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">{t('yourRating')}</p>
        <div className="flex gap-1" onMouseLeave={() => setHovered(0)}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`${value}`}
              onMouseEnter={() => setHovered(value)}
              onClick={() => setRating(value)}
              className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star
                className={cn(
                  'h-7 w-7 transition-colors',
                  value <= (hovered || rating) ? 'fill-brand-500 text-brand-500' : 'text-muted-foreground',
                )}
              />
            </button>
          ))}
        </div>
      </div>

      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t('reviewComment')}
        rows={3}
      />

      <Button onClick={submit} disabled={rating < 1} loading={submitReview.isPending}>
        {t('submitReview')}
      </Button>
    </div>
  );
}
