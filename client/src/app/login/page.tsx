import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth/ui/login-form';

export const metadata: Metadata = { title: 'Вход' };

export default function LoginPage() {
  return (
    <div className="container flex justify-center py-12">
      <LoginForm />
    </div>
  );
}
