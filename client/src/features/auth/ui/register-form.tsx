'use client';

import Link from 'next/link';
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
import { Checkbox } from '@/shared/ui/checkbox';
import { registerSchema, type RegisterValues } from '../model/schemas';
import { useRegister } from '../model/use-auth';

export function RegisterForm({ initialReferralCode }: { initialReferralCode?: string }) {
  const t = useTranslations('auth');
  const te = useTranslations('errors');
  const router = useRouter();
  const registerMutation = useRegister();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { referralCode: initialReferralCode ?? '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await registerMutation.mutateAsync({
        email: values.email,
        password: values.password,
        firstName: values.firstName,
        // Empty optional strings must not be sent — the API validates format.
        lastName: values.lastName || undefined,
        phone: values.phone || undefined,
        referralCode: values.referralCode || undefined,
        acceptPrivacyPolicy: true,
      });
      router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось зарегистрироваться');
    }
  });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('registerTitle')}</CardTitle>
        <CardDescription>Chicago Pizza · Махачкала</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('firstName')}
              htmlFor="firstName"
              error={errors.firstName && te(errors.firstName.message!)}
            >
              <Input id="firstName" autoComplete="given-name" {...register('firstName')} />
            </FormField>

            <FormField label={t('lastName')} htmlFor="lastName">
              <Input id="lastName" autoComplete="family-name" {...register('lastName')} />
            </FormField>
          </div>

          <FormField label={t('email')} htmlFor="email" error={errors.email && te(errors.email.message!)}>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
          </FormField>

          <FormField
            label={t('phone')}
            htmlFor="phone"
            hint="+79280000000"
            error={errors.phone && te(errors.phone.message!)}
          >
            <Input id="phone" type="tel" autoComplete="tel" placeholder="+79280000000" {...register('phone')} />
          </FormField>

          <FormField
            label={t('password')}
            htmlFor="password"
            error={errors.password && te(errors.password.message!)}
          >
            <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
          </FormField>

          <FormField label={t('referralCode')} htmlFor="referralCode">
            <Input id="referralCode" className="uppercase" {...register('referralCode')} />
          </FormField>

          <div className="space-y-1">
            <Checkbox
              id="acceptPrivacyPolicy"
              className="items-start"
              {...register('acceptPrivacyPolicy')}
              label={
                <span className="text-sm leading-snug text-muted-foreground">
                  {t.rich('consent', {
                    policy: (chunks) => (
                      <Link href="/privacy" target="_blank" className="font-medium text-primary hover:underline">
                        {chunks}
                      </Link>
                    ),
                    terms: (chunks) => (
                      <Link href="/terms" target="_blank" className="font-medium text-primary hover:underline">
                        {chunks}
                      </Link>
                    ),
                  })}
                </span>
              }
            />
            {errors.acceptPrivacyPolicy ? (
              <p role="alert" className="text-sm text-destructive">
                {te(errors.acceptPrivacyPolicy.message!)}
              </p>
            ) : null}
          </div>

          <Button type="submit" className="w-full" loading={registerMutation.isPending}>
            {t('register')}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {t('hasAccount')}{' '}
            <Link href="/login" className="font-medium text-primary hover:underline">
              {t('login')}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
