'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { cn } from '@/shared/lib/cn';
import { Skeleton } from '@/shared/ui/skeleton';
import { useCurrentUser } from '@/entities/user/queries';

const STAFF_ROLES = ['ADMIN', 'SUPPORT', 'COURIER'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('admin');
  const pathname = usePathname();
  const router = useRouter();
  const { data: user, isLoading, isError, refetch } = useCurrentUser();
  const loginUrl = `/login?redirect=${encodeURIComponent(pathname)}`;
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname, user?.role, isLoading]);

  useEffect(() => {
    if (isLoading || isError) return;
    if (!user) router.replace(loginUrl);
    else if (user.role === 'SUPPORT' && pathname === '/admin') router.replace('/admin/tickets');
  }, [isLoading, isError, user, pathname, loginUrl, router]);

  if (isLoading) {
    return (
      <div className="container space-y-4 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container space-y-4 py-24 text-center" role="alert">
        <h1 className="text-2xl font-bold">{t('sessionErrorTitle')}</h1>
        <p className="text-muted-foreground">{t('sessionErrorDescription')}</p>
        <button
          onClick={() => void refetch()}
          className="rounded-md bg-primary px-4 py-3 text-primary-foreground"
        >
          {t('retrySession')}
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container space-y-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{t('signInRequired')}</h1>
        <p className="text-muted-foreground">{t('signInDescription')}</p>
        <Link
          href={loginUrl}
          className="inline-block rounded-md bg-primary px-4 py-3 text-primary-foreground"
        >
          {t('signInAction')}
        </Link>
      </div>
    );
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

  const hasAccess =
    STAFF_ROLES.includes(user.role) &&
    tabs.some((tab) =>
      tab.href === '/admin'
        ? pathname === tab.href
        : pathname === tab.href || pathname.startsWith(`${tab.href}/`),
    );

  if (!hasAccess) {
    return (
      <div className="container space-y-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{t('accessDenied')}</h1>
        <p className="text-muted-foreground">{t('accessDeniedDescription')}</p>
        <Link
          href={tabs[0]?.href ?? '/menu'}
          className="inline-block rounded-md bg-primary px-4 py-3 text-primary-foreground"
        >
          {tabs.length ? t('openAllowedSection') : t('backToMenu')}
        </Link>
      </div>
    );
  }

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
