'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import { WS_EVENTS } from '@/shared/api/socket';
import { useSocketEvent } from '@/shared/lib/use-socket-event';
import { useFormatters } from '@/shared/lib/use-formatters';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { useCurrentUser } from '@/entities/user/queries';
import { useMarkNotificationsRead, useNotifications, supportKeys } from '@/entities/support/queries';

/**
 * The notifications service has always written a row per order status change
 * and support reply; nothing in the UI ever read them. This is that reader:
 * an unread counter in the header and a panel with the latest entries.
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const { formatDateTime } = useFormatters();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: user } = useCurrentUser();
  const { data } = useNotifications();
  const markRead = useMarkNotificationsRead();

  // The gateway pings the user's room whenever it writes a notification.
  useSocketEvent(
    WS_EVENTS.NOTIFICATION,
    () => qc.invalidateQueries({ queryKey: supportKeys.notifications }),
    !!user,
  );

  // Clicking anywhere else, or pressing Escape, closes the panel.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('title')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span
            aria-label={t('unread', { count: unread })}
            className="absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] font-black leading-none text-primary-foreground"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label={t('title')}
          className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-border bg-card shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <span className="font-heading font-black">{t('title')}</span>
            {unread > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                loading={markRead.isPending}
                onClick={() => markRead.mutate(undefined)}
              >
                {t('markAll')}
              </Button>
            ) : null}
          </div>

          {items.length ? (
            <ul className="max-h-[60vh] overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => !item.isRead && markRead.mutate(item.id)}
                    className={cn(
                      'w-full border-b border-border/60 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-foreground/[0.04]',
                      item.isRead ? 'opacity-70' : '',
                    )}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      {item.title}
                      {item.isRead ? null : (
                        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                      )}
                    </span>
                    <span className="mt-0.5 block text-muted-foreground">{item.body}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {formatDateTime(item.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
