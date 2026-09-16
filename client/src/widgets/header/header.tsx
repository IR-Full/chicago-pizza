'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LogOut, ShieldCheck, ShoppingCart, User as UserIcon, X } from 'lucide-react';
import { useCurrentUser } from '@/entities/user/queries';
import { useCart } from '@/entities/cart/queries';
import { useLogout } from '@/features/auth/model/use-auth';
import { ThemeToggle } from '@/features/theme/theme-toggle';
import { LocaleSwitcher } from '@/features/locale/locale-switcher';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';

/** The round terracotta mark that opens the brand lockup. */
function BrandMark({ className }: { className?: string }) {
  const locale = useLocale();
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-primary font-heading font-black leading-none text-primary-foreground',
        className,
      )}
    >
      {locale === 'ru' ? 'Ч' : 'C'}
    </span>
  );
}

export function Header() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const { data: user } = useCurrentUser();
  const { data: cart } = useCart();
  const logout = useLogout();
  const [navOpen, setNavOpen] = useState(false);

  const isStaff = user?.role === 'ADMIN' || user?.role === 'SUPPORT' || user?.role === 'COURIER';
  const itemCount = cart?.itemCount ?? 0;

  // The mobile sheet covers the page, so the page behind it must not scroll.
  useEffect(() => {
    if (!navOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  // Any navigation closes the sheet.
  useEffect(() => setNavOpen(false), [pathname]);

  const links = [
    { href: '/menu', label: t('menu') },
    ...(user ? [{ href: '/orders', label: t('orders') }] : []),
    ...(user ? [{ href: '/support', label: t('support') }] : []),
    ...(isStaff ? [{ href: '/admin', label: t('admin') }] : []),
  ];

  return (
    <>
      <header className="sticky top-0 z-40 w-full bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
        <div className="container flex min-h-[70px] items-center gap-3 py-2.5 md:gap-5">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5 font-heading text-[clamp(1.05rem,2vw,1.25rem)] font-black"
          >
            <BrandMark className="h-9 w-9 text-lg" />
            <span className="hidden whitespace-nowrap min-[420px]:inline">{tc('brand')}</span>
          </Link>

          <nav className="ml-auto hidden items-center gap-5 md:flex">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
                className={cn(
                  'text-[14.5px] transition-colors hover:text-brand-700',
                  pathname === href ? 'text-brand-700' : 'text-foreground/80',
                )}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <div className="hidden sm:flex sm:items-center">
              <LocaleSwitcher />
              <ThemeToggle />
            </div>

            <Button asChild className="gap-2 px-4 md:px-5">
              <Link href="/cart" aria-label={t('cart')}>
                <ShoppingCart className="h-[18px] w-[18px]" aria-hidden />
                <span className="hidden sm:inline">{t('cart')}</span>
                <span aria-hidden className="opacity-60">
                  ·
                </span>
                <span>{itemCount}</span>
              </Link>
            </Button>

            {user ? (
              <div className="hidden items-center gap-1 md:flex">
                <Button variant="ghost" size="icon" asChild aria-label={t('profile')}>
                  <Link href="/profile">
                    {isStaff ? <ShieldCheck className="h-5 w-5" /> : <UserIcon className="h-5 w-5" />}
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('logout')}
                  onClick={() => logout.mutate()}
                  loading={logout.isPending}
                >
                  <LogOut className="h-5 w-5" />
                </Button>
              </div>
            ) : (
              <Button variant="outline" asChild className="hidden md:inline-flex">
                <Link href="/login">{t('login')}</Link>
              </Button>
            )}

            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label={t('menu')}
              aria-expanded={navOpen}
              className="grid h-11 w-11 shrink-0 place-items-center gap-[5px] rounded-full border border-brand-300 transition-colors hover:bg-brand-100 md:hidden"
            >
              <span className="block h-[2.75px] w-[19px] rounded-sm bg-foreground" />
              <span className="block h-[2.75px] w-[19px] rounded-sm bg-foreground" />
              <span className="block h-[2.75px] w-[19px] rounded-sm bg-foreground" />
            </button>
          </div>
        </div>
      </header>

      {navOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background px-[clamp(1.125rem,4vw,2rem)] pb-6 pt-2.5 md:hidden">
          <div className="flex min-h-[62px] items-center justify-between gap-3">
            <span className="flex items-center gap-2.5 font-heading text-lg font-black">
              <BrandMark className="h-9 w-9 text-lg" />
              {tc('brand')}
            </span>
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              aria-label={tc('close')}
              className="grid h-11 w-11 place-items-center rounded-full border border-brand-300 transition-colors hover:bg-brand-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="mt-3.5 grid font-heading text-[clamp(1.5rem,7vw,2rem)] font-black">
            {links.map(({ href, label }) => (
              <Link key={href} href={href} className="border-b border-brand-200 py-[18px]">
                {label}
              </Link>
            ))}
            {user ? (
              <Link href="/profile" className="border-b border-brand-200 py-[18px]">
                {t('profile')}
              </Link>
            ) : (
              <Link href="/login" className="border-b border-brand-200 py-[18px]">
                {t('login')}
              </Link>
            )}
          </nav>

          <div className="mt-7 flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
            {user ? (
              <Button
                variant="outline"
                className="ml-auto gap-2"
                onClick={() => logout.mutate()}
                loading={logout.isPending}
              >
                <LogOut className="h-4 w-4" />
                {t('logout')}
              </Button>
            ) : null}
          </div>

          <Button variant="outline" asChild className="mt-auto self-start">
            <a href="tel:+78722555555">+7 8722 55-55-55</a>
          </Button>
        </div>
      ) : null}
    </>
  );
}
