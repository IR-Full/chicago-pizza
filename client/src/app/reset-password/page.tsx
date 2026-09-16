'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/api-client';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { resetPasswordSchema, type ResetPasswordValues } from '@/features/auth/model/schemas';
import { useResetPassword } from '@/features/auth/model/use-auth';

export default function ResetPasswordPage() {
  const t = useTranslations('auth');
  const te = useTranslations('errors');
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const reset = useResetPassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema) });

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    try {
      await reset.mutateAsync({ token, newPassword });
      toast.success(t('emailVerified'));
      router.push('/login');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Ссылка недействительна');
    }
  });

  if (!token) {
    return (
      <div className="container py-12 text-center text-muted-foreground">Ссылка восстановления недействительна</div>
    );
  }

  return (
    <div className="container flex justify-center py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('resetPassword')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField
              label={t('newPassword')}
              htmlFor="newPassword"
              error={errors.newPassword && te(errors.newPassword.message!)}
            >
              <Input id="newPassword" type="password" autoComplete="new-password" {...register('newPassword')} />
            </FormField>
            <Button type="submit" className="w-full" loading={reset.isPending}>
              {t('resetPassword')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
