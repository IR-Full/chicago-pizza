'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/features/auth/model/schemas';
import { useForgotPassword } from '@/features/auth/model/use-auth';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const te = useTranslations('errors');
  const forgot = useForgotPassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    await forgot.mutateAsync(email);
    // The API deliberately answers the same way whether or not the account
    // exists, so the message must stay non-committal too.
    toast.success(t('resetLinkSent'));
  });

  return (
    <div className="container flex justify-center py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('resetPassword')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField label={t('email')} htmlFor="email" error={errors.email && te(errors.email.message!)}>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
            </FormField>
            <Button type="submit" className="w-full" loading={forgot.isPending}>
              {t('sendResetLink')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
