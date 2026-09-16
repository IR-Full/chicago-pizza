'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/api-client';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { verifyEmailSchema, type VerifyEmailValues } from '../model/schemas';
import { useResendVerification, useVerifyEmail } from '../model/use-auth';

export function VerifyEmailForm({ email }: { email: string }) {
  const t = useTranslations('auth');
  const te = useTranslations('errors');
  const router = useRouter();
  const verify = useVerifyEmail();
  const resend = useResendVerification();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VerifyEmailValues>({ resolver: zodResolver(verifyEmailSchema) });

  const onSubmit = handleSubmit(async ({ code }) => {
    try {
      await verify.mutateAsync({ email, code });
      toast.success(t('emailVerified'));
      router.push('/login');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось подтвердить email');
    }
  });

  async function onResend() {
    try {
      await resend.mutateAsync(email);
      toast.success(t('resendCode'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось отправить код');
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('verifyTitle')}</CardTitle>
        <CardDescription>{t('verifyHint', { email })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField
            label={t('verificationCode')}
            htmlFor="code"
            error={errors.code && te(errors.code.message!)}
          >
            <Input
              id="code"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              className="text-center text-2xl tracking-[0.5em]"
              {...register('code')}
            />
          </FormField>

          <Button type="submit" className="w-full" loading={verify.isPending}>
            {t('verify')}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={onResend}
            loading={resend.isPending}
          >
            {t('resendCode')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
