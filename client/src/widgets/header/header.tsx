'use client';

import { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut, Menu as MenuIcon, ShieldCheck, ShoppingCart, User as UserIcon, X } from 'lucide-react';
import { useCurrentUser } from '@/entities/user/queries';
import { useCart } from '@/entities/cart/queries';
import { useLogout } from '@/features/auth/model/use-auth';
import { ThemeToggle } from '@/features/theme/theme-toggle';
import { LocaleSwitcher } from '@/features/locale/locale-switcher';
import { NotificationBell } from '@/widgets/notifications/notification-bell';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';

const wordmark =
  'block w-min font-heading text-[1.5rem] font-bold uppercase leading-[0.9] tracking-[-0.035em] sm:text-[1.75rem]';
const posterFocus =
  'focus-visible:ring-[color:var(--poster-foreground)] focus-visible:ring-offset-[color:var(--poster-background)]';
const posterIcon = 'hover:bg-white/10 hover:text-[var(--poster-foreground)]';
const sheetLink =
  'flex min-h-[3.25rem] items-center border-b border-border py-2.5 transition-colors hover:text-primary';

export function Header() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const tf = useTranslations('footer');
  const pathname = usePathname();
  const onHome = pathname === '/';
  const { data: user } = useCurrentUser();
  const { data: cart } = useCart();
  const logout = useLogout();
  const [navOpen, setNavOpen] = useState(false);

  const isStaff = user?.role === 'ADMIN' || user?.role === 'SUPPORT' || user?.role === 'COURIER';
  const itemCount = cart?.itemCount ?? 0;

  useEffect(() => {
    if (!navOpen) return;

    // The sheet occupies the viewport and must release the page when its
    // trigger disappears at the desktop breakpoint.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 1280px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setNavOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  useEffect(() => setNavOpen(false), [pathname]);

  const links = [
    { href: '/menu', label: t('menu') },
    { href: '/#promos', label: tf('offers') },
    { href: '/#contacts', label: t('contacts') },
    ...(user
      ? [
          { href: '/orders', label: t('orders') },
          { href: '/support', label: t('support') },
        ]
      : []),
    ...(isStaff ? [{ href: '/admin', label: t('admin') }] : []),
  ];

  const sheetLinks = [
    ...links,
    { href: '/cart', label: t('cart') },
    user ? { href: '/profile', label: t('profile') } : { href: '/login', label: t('login') },
  ];

  return (
    <DialogPrimitive.Root open={navOpen} onOpenChange={setNavOpen}>
      <header
        className={cn(
          'sticky top-0 z-40 w-full',
          onHome
            ? 'bg-[var(--poster-background)] text-[var(--poster-foreground)]'
            : 'border-b border-border bg-background text-foreground',
        )}
      >
        <div className="container flex min-h-[3.625rem] items-center gap-3 py-1.5 xl:min-h-[4.625rem] xl:gap-7">
          <Link href="/" aria-label={tc('brand')} className={cn('shrink-0', onHome && posterFocus)}>
            <span className={wordmark}>{tc('brand')}</span>
          </Link>

          <nav
            aria-label={t('menu')}
            className="hidden min-w-0 flex-wrap items-center gap-x-4 xl:flex 2xl:gap-x-6"
          >
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center whitespace-nowrap text-sm font-semibold underline-offset-4 hover:underline aria-[current=page]:underline',
                  onHome && posterFocus,
                )}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <div
              className={cn(
                'mr-1 hidden items-center border-r pr-2 xl:flex',
                onHome ? 'border-white/30' : 'border-border',
              )}
            >
              <LocaleSwitcher onPoster={onHome} />
            </div>

            <ThemeToggle
              className={cn(
                'rounded-lg border',
                onHome
                  ? 'border-white/30 bg-[var(--poster-foreground)] text-[#211e1b] hover:bg-white hover:text-[#211e1b] dark:bg-white/10 dark:text-[var(--poster-foreground)] dark:hover:bg-white/[0.18] dark:hover:text-[var(--poster-foreground)]'
                  : 'border-border',
                onHome && posterFocus,
              )}
            />

            <Button
              asChild
              className={cn(
                'gap-1.5 rounded-lg px-2.5 font-sans font-bold sm:gap-2 sm:px-3.5',
                onHome &&
                  'border border-white/50 bg-transparent text-[var(--poster-foreground)] hover:bg-white/10 active:bg-white/[0.18] xl:border-transparent xl:bg-[var(--poster-foreground)] xl:text-[#211e1b] xl:hover:bg-white xl:active:bg-[#efe3d7]',
                onHome && posterFocus,
              )}
            >
              <Link
                href="/cart"
                aria-label={t('cart')}
                aria-current={pathname === '/cart' ? 'page' : undefined}
              >
                <ShoppingCart className="h-[18px] w-[18px]" aria-hidden />
                <span className="hidden xl:inline">{t('cart')}</span>
                <span aria-hidden className="hidden xl:inline">
                  ·
                </span>
                <span className="tabular-nums">{itemCount}</span>
              </Link>
            </Button>

            {user ? (
              <div className="hidden items-center gap-1 xl:flex">
                <div
                  className={cn(
                    'text-foreground',
                    onHome &&
                      '[&>div>button]:text-[var(--poster-foreground)] [&>div>button]:hover:bg-white/10 [&>div>button]:hover:text-[var(--poster-foreground)] [&>div>button]:focus-visible:ring-[color:var(--poster-foreground)] [&>div>button]:focus-visible:ring-offset-[color:var(--poster-background)]',
                  )}
                >
                  <NotificationBell />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  asChild
                  aria-label={t('profile')}
                  className={cn(onHome && posterIcon, onHome && posterFocus)}
                >
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
                  className={cn(onHome && posterIcon, onHome && posterFocus)}
                >
                  <LogOut className="h-5 w-5" />
                </Button>
              </div>
            ) : (
              <Button
                asChild
                variant={onHome ? 'default' : 'outline'}
                className={cn(
                  'hidden rounded-lg px-4 font-sans font-bold xl:inline-flex',
                  onHome &&
                    'bg-[#211e1b] text-[#faf5ed] hover:bg-[#362e29] active:bg-[#171513] dark:bg-primary dark:text-primary-foreground dark:hover:bg-[hsl(var(--primary-hover))]',
                  onHome && posterFocus,
                )}
              >
                <Link href="/login">{t('login')}</Link>
              </Button>
            )}

            <DialogPrimitive.Trigger asChild>
              <button
                type="button"
                aria-label={t('menu')}
                className={cn(
                  'grid h-11 w-11 place-items-center rounded-lg transition-colors xl:hidden',
                  onHome ? posterIcon : 'hover:bg-accent hover:text-accent-foreground',
                  onHome && posterFocus,
                )}
              >
                <MenuIcon className="h-6 w-6" aria-hidden />
              </button>
            </DialogPrimitive.Trigger>
          </div>
        </div>
      </header>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-modal="true"
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex h-dvh flex-col overflow-y-auto overscroll-contain bg-background px-[clamp(1.125rem,4vw,2rem)] pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(0.625rem,env(safe-area-inset-top))] text-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 motion-safe:duration-200 xl:hidden"
        >
          <div className="flex min-h-[3.625rem] items-center justify-between gap-3 border-b border-border pb-2.5">
            <DialogPrimitive.Title className={wordmark}>{tc('brand')}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="outline" size="icon" aria-label={tc('close')} className="rounded-lg">
                <X className="h-5 w-5" aria-hidden />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <nav aria-label={t('menu')} className="mt-2 grid font-heading text-2xl font-semibold">
            {sheetLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
                onClick={() => setNavOpen(false)}
                className={cn(sheetLink, pathname === href && 'text-primary')}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="mt-4 flex flex-wrap items-center gap-2 pb-5">
            <LocaleSwitcher />
            <ThemeToggle className="rounded-lg border border-border" />
            {user ? (
              <>
                <NotificationBell />
                <Button
                  variant="outline"
                  className="ml-auto gap-2 rounded-lg"
                  onClick={() => logout.mutate()}
                  loading={logout.isPending}
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                  {t('logout')}
                </Button>
              </>
            ) : null}
          </div>

          <Button variant="outline" asChild className="mt-auto shrink-0 self-start rounded-lg">
            <a href="tel:+78722555555">+7 8722 55-55-55</a>
          </Button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
