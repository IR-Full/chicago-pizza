'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Download, LogOut, Monitor, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/api-client';
import { userApi } from '@/entities/user/api';
import { useRevokeSession, useSessions } from '@/entities/user/queries';
import { useFormatters } from '@/shared/lib/use-formatters';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';

/**
 * The rights half of the personal-data policy, in the one place a customer
 * would look for it.
 *
 * Nothing here is decorative: the session list exists because `ip` and
 * `userAgent` have been recorded on every sign-in all along and were shown to
 * nobody, and erasure exists because consent that cannot be withdrawn is not
 * consent. The policy page promises all three by name.
 */
export function PrivacySection() {
  const t = useTranslations('privacy');
  const tc = useTranslations('common');
  const { formatDateTime } = useFormatters();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: sessions = [], isLoading } = useSessions();
  const revokeSession = useRevokeSession();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const download = async () => {
    setExporting(true);
    try {
      const data = await userApi.exportData();
      // Built in the browser rather than following a link: the request needs
      // the session cookie and an `<a download>` would not carry the 401
      // retry the API client does.
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'chicago-pizza-data.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const eraseAccount = async () => {
    setDeleting(true);
    try {
      await userApi.deleteAccount();
      queryClient.clear();
      toast.success(t('deleted'));
      router.push('/');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('deleteFailed'));
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Sessions ────────────────────────────────────────── */}
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">{t('sessionsTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('sessionsHint')}</p>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">{tc('loading')}</p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((session) => (
                <li key={session.id} className="flex items-center gap-3 rounded-md border p-3 text-sm">
                  <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      {session.ip ?? t('unknownIp')}
                      {session.isCurrent ? <Badge variant="secondary">{t('currentSession')}</Badge> : null}
                    </p>
                    <p className="truncate text-muted-foreground">
                      {session.userAgent ?? t('unknownDevice')} · {formatDateTime(session.createdAt)}
                    </p>
                  </div>
                  {session.isCurrent ? null : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('endSession')}
                      onClick={() => revokeSession.mutate(session.id)}
                      disabled={revokeSession.isPending}
                    >
                      <LogOut className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Export ──────────────────────────────────────────── */}
        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">{t('exportTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('exportHint')}</p>
          <Button variant="outline" onClick={download} loading={exporting}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            {t('exportAction')}
          </Button>
        </section>

        {/* ── Erasure ─────────────────────────────────────────── */}
        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium text-destructive">{t('deleteTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('deleteHint')}</p>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            {t('deleteAction')}
          </Button>
        </section>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
            </DialogHeader>
            {/* Says what survives, because "delete everything" would be a lie:
                orders are accounting records with their own retention. */}
            <p className="text-sm text-muted-foreground">{t('deleteConfirmBody')}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                {tc('cancel')}
              </Button>
              <Button variant="destructive" onClick={eraseAccount} loading={deleting}>
                {t('deleteConfirmAction')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
