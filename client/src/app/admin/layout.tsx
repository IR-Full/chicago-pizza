'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { cn } from '@/shared/lib/cn';
import { Skeleton } from '@/shared/ui/skeleton';
import { useCurrentUser } from '@/entities/user/queries';

const STAFF_ROLES = ['ADMIN', 'SUPPORT', 'COURIER'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('admin');
  const pathname = usePathname();
  const { data: user, isLoading } = useCurrentUser();
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname, user?.role, isLoading]);

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
    { href: '/admin/kitchen', label: t('kitchen'), roles: ['ADMIN', 'COURIER'] },
    // `COURIER` is what every non-managerial member of staff is given — there
    // is no `KITCHEN` role — so it covers the people at the oven as well as the
    // ones driving. Mirrors the grants on `AdminController`, where the trade-off
    // is spelled out.
    { href: '/admin/stop-list', label: t('stopList'), roles: ['ADMIN', 'COURIER'] },
    // The menu itself, as opposed to tonight's stop list. Admin only: changing
    // a price or taking an item off the menu for good is a different decision
    // from noticing the mozzarella has run out.
    { href: '/admin/products', label: t('products'), roles: ['ADMIN'] },
    { href: '/admin/analytics', label: t('analytics'), roles: ['ADMIN'] },
    { href: '/admin/promocodes', label: t('promocodes'), roles: ['ADMIN'] },
    { href: '/admin/users', label: t('users'), roles: ['ADMIN'] },
    { href: '/admin/tickets', label: t('tickets'), roles: ['ADMIN', 'SUPPORT'] },
  ].filter((tab) => tab.roles.includes(user.role));

  return (
    <div className="container space-y-6 py-10">
      <h1 className="text-[clamp(1.75rem,3.4vw,2.5rem)] font-black">{t('title')}</h1>

      <nav
        ref={navRef}
        tabIndex={0}
        aria-label={t('title')}
        className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto border-b pb-2"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={pathname === tab.href ? 'page' : undefined}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
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
