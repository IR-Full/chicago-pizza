import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { VerifyEmailForm } from '@/features/auth/ui/verify-email-form';

export const metadata: Metadata = { title: 'Подтверждение email' };

export default function VerifyEmailPage({ searchParams }: { searchParams: { email?: string } }) {
  if (!searchParams.email) redirect('/register');

  return (
    <div className="container flex justify-center py-12">
      <VerifyEmailForm email={searchParams.email} />
    </div>
  );
}
