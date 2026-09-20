import type { Metadata } from 'next';
import { RegisterForm } from '@/features/auth/ui/register-form';

export const metadata: Metadata = { title: 'Регистрация' };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;

  return (
    <div className="container flex justify-center py-12">
      <RegisterForm initialReferralCode={ref} />
    </div>
  );
}
