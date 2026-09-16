import type { Metadata } from 'next';
import { RegisterForm } from '@/features/auth/ui/register-form';

export const metadata: Metadata = { title: 'Регистрация' };

export default function RegisterPage({ searchParams }: { searchParams: { ref?: string } }) {
  return (
    <div className="container flex justify-center py-12">
      <RegisterForm initialReferralCode={searchParams.ref} />
    </div>
  );
}
