'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/api-client';
import { Button } from '@/shared/ui/button';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { useCreateAddress } from '@/entities/user/queries';

const addressSchema = z.object({
  title: z.string().min(1, 'required').max(100),
  street: z.string().min(1, 'required').max(200),
  house: z.string().min(1, 'required').max(20),
  apartment: z.string().max(20).optional().or(z.literal('')),
  entrance: z.string().max(20).optional().or(z.literal('')),
  floor: z.string().max(20).optional().or(z.literal('')),
  comment: z.string().max(500).optional().or(z.literal('')),
});

type AddressValues = z.infer<typeof addressSchema>;

export function AddressForm({ onCreated }: { onCreated: (addressId: string) => void }) {
  const t = useTranslations('checkout');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const createAddress = useCreateAddress();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddressValues>({ resolver: zodResolver(addressSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const address = await createAddress.mutateAsync({
        title: values.title,
        city: 'Махачкала',
        street: values.street,
        house: values.house,
        apartment: values.apartment || null,
        entrance: values.entrance || null,
        floor: values.floor || null,
        comment: values.comment || null,
        // 2GIS map picker would populate these; typing the address by hand
        // leaves them empty, which the API accepts.
        lat: null,
        lng: null,
        isDefault: false,
      });
      reset();
      onCreated(address.id);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось сохранить адрес');
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-4" noValidate>
      <FormField label={t('addressTitle')} htmlFor="title" error={errors.title && te(errors.title.message!)}>
        <Input id="title" placeholder="Дом" {...register('title')} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          className="sm:col-span-2"
          label={t('street')}
          htmlFor="street"
          error={errors.street && te(errors.street.message!)}
        >
          <Input id="street" placeholder="пр. Имама Шамиля" {...register('street')} />
        </FormField>
        <FormField label={t('house')} htmlFor="house" error={errors.house && te(errors.house.message!)}>
          <Input id="house" placeholder="48" {...register('house')} />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t('apartment')} htmlFor="apartment">
          <Input id="apartment" {...register('apartment')} />
        </FormField>
        <FormField label={t('entrance')} htmlFor="entrance">
          <Input id="entrance" {...register('entrance')} />
        </FormField>
        <FormField label={t('floor')} htmlFor="floor">
          <Input id="floor" {...register('floor')} />
        </FormField>
      </div>

      <FormField label={t('addressComment')} htmlFor="comment">
        <Textarea id="comment" rows={2} {...register('comment')} />
      </FormField>

      <Button type="submit" loading={createAddress.isPending}>
        {tc('save')}
      </Button>
    </form>
  );
}
