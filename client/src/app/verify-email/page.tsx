import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { VerifyEmailForm } from '@/features/auth/ui/verify-email-form';

export const metadata: Metadata = { title: 'Подтверждение email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  if (!email) redirect('/register');

  return (
    <div className="container flex justify-center py-12">
      <VerifyEmailForm email={email} />
    </div>
  );
}
