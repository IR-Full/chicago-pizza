'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/shared/lib/cn';
import { Skeleton } from '@/shared/ui/skeleton';
import { useCurrentUser } from '@/entities/user/queries';

const STAFF_ROLES = ['ADMIN', 'SUPPORT', 'COURIER'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('admin');
  const pathname = usePathname();
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="container space-y-4 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  // The API enforces this server-side too — this only avoids rendering a
  // dashboard shell that would fail every request anyway.
  if (!user || !STAFF_ROLES.includes(user.role)) {
    return <div className="container py-24 text-center text-muted-foreground">403</div>;
  }

  const tabs = [
    { href: '/admin', label: t('orders'), roles: ['ADMIN', 'COURIER'] },
    { href: '/admin/promocodes', label: t('promocodes'), roles: ['ADMIN'] },
    { href: '/admin/users', label: t('users'), roles: ['ADMIN'] },
    { href: '/admin/tickets', label: t('tickets'), roles: ['ADMIN', 'SUPPORT'] },
  ].filter((tab) => tab.roles.includes(user.role));

  return (
    <div className="container space-y-6 py-10">
      <h1 className="text-[clamp(1.75rem,3.4vw,2.5rem)] font-black">{t('title')}</h1>

      <nav className="flex flex-wrap gap-2 border-b pb-2">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              pathname === tab.href ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
