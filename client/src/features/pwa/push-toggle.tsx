'use client';

import { useTranslations } from 'next-intl';
import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/shared/ui/button';
import { usePushSubscription } from './use-push-subscription';

/**
 * Turns browser notifications on for this device.
 *
 * Renders nothing at all when the shop has no VAPID keys, or the browser
 * cannot do push — an inert switch is worse than no switch. A refusal the
 * customer already gave is shown as a hint rather than a button, because the
 * page cannot re-ask: only the browser's own site settings can undo a denial.
 */
export function PushToggle() {
  const t = useTranslations('profile');
  const { state, isBusy, subscribe, unsubscribe } = usePushSubscription();

  if (state === 'unsupported' || state === 'unconfigured') return null;

  if (state === 'denied') {
    return <p className="text-xs text-muted-foreground">{t('pushBlocked')}</p>;
  }

  const isOn = state === 'on';

  async function toggle() {
    try {
      await (isOn ? unsubscribe() : subscribe());
    } catch {
      toast.error(t('pushFailed'));
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-sm font-medium">{t('pushTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('pushHint')}</p>
      </div>
      <Button variant={isOn ? 'outline' : 'default'} size="sm" className="gap-2" loading={isBusy} onClick={toggle}>
        {isOn ? <BellOff className="h-4 w-4" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
        {isOn ? t('pushOff') : t('pushOn')}
      </Button>
    </div>
  );
}
