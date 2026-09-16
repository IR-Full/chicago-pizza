'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/api-client';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { loginSchema, type LoginValues } from '../model/schemas';
import { useLogin } from '../model/use-auth';

export function LoginForm() {
  const t = useTranslations('auth');
  const te = useTranslations('errors');
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useLogin();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      // Send the user back where they came from (e.g. checkout).
      router.push(searchParams.get('redirect') ?? '/menu');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось войти');
    }
  });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('loginTitle')}</CardTitle>
        <CardDescription>Chicago Pizza · Махачкала</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField label={t('email')} htmlFor="email" error={errors.email && te(errors.email.message!)}>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
          </FormField>

          <FormField
            label={t('password')}
            htmlFor="password"
            error={errors.password && te(errors.password.message!)}
          >
            <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
          </FormField>

          <Button type="submit" className="w-full" loading={login.isPending}>
            {t('login')}
          </Button>

          <div className="flex items-center justify-between text-sm">
            <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
              {t('forgotPassword')}
            </Link>
            <span className="text-muted-foreground">
              {t('noAccount')}{' '}
              <Link href="/register" className="font-medium text-primary hover:underline">
                {t('register')}
              </Link>
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
