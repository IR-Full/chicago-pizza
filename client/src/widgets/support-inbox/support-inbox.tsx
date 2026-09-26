'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/api-client';
import { useFormatters } from '@/shared/lib/use-formatters';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { Pagination } from '@/shared/ui/pagination';
import { Textarea } from '@/shared/ui/textarea';
import { useCreateTicket, useTickets } from '@/entities/support/queries';
import { useCurrentUser } from '@/entities/user/queries';
import { ChatThread } from '@/widgets/support-chat/chat-thread';

/**
 * The support inbox: the list of a customer's tickets beside the selected
 * thread.
 *
 * Which ticket is open lives in the URL, not only in component state, because
 * the reply notification mails a link straight to one — `/support/<id>` used
 * to be a 404, so every "there is a new answer" letter led nowhere.
 */
export function SupportInbox({ initialTicketId }: { initialTicketId?: string }) {
  const t = useTranslations('support');
  const tstatus = useTranslations('support.status');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const { formatDateTime } = useFormatters();

  const { data: user, isLoading } = useCurrentUser();
  const [page, setPage] = useState(1);
  const { data: ticketPage } = useTickets(page);
  const tickets = ticketPage?.items ?? [];
  const createTicket = useCreateTicket();

  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(initialTicketId ?? null);

  // Selecting a ticket rewrites the address so the thread can be linked to,
  // reloaded and shared. `replace` keeps the back button pointing at whatever
  // the customer was doing before support, not at each thread they skimmed.
  function openTicket(ticketId: string) {
    setSelectedId(ticketId);
    router.replace(`/support/${ticketId}`);
  }
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    try {
      const ticket = await createTicket.mutateAsync({ subject: subject.trim(), message: message.trim() });
      setSubject('');
      setMessage('');
      setShowForm(false);
      openTicket(ticket.id);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось создать обращение');
    }
  }

  if (isLoading) return <div className="container py-24 text-center text-muted-foreground">{tc('loading')}</div>;

  if (!user) {
    return (
      <div className="container flex flex-col items-center gap-4 py-24 text-center">
        <p>{te('loginRequired')}</p>
        <Button asChild>
          <Link href="/login?redirect=/support">{te('loginRequired')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container grid gap-6 py-10 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-4">
        {/*
          Wraps, because this row lives in a 20rem column: the heading alone
          is ~230px at its largest clamp step, and the button needs another
          150 — unwrapped it overflowed the column and slid under the card
          beside it.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[clamp(1.75rem,3.4vw,2.5rem)] font-black">{t('title')}</h1>
          <Button size="sm" className="ml-auto" onClick={() => setShowForm((v) => !v)}>
            {t('newTicket')}
          </Button>
        </div>

        {showForm ? (
          <Card>
            <CardContent className="p-4">
              <form onSubmit={submit} className="space-y-3">
                <FormField label={t('subject')} htmlFor="subject">
                  <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                </FormField>
                <FormField label={t('message')} htmlFor="message">
                  <Textarea id="message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
                </FormField>
                <Button type="submit" className="w-full" loading={createTicket.isPending}>
                  {t('send')}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {tickets.length ? (
          <ul className="space-y-2">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <button
                  type="button"
                  onClick={() => openTicket(ticket.id)}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors',
                    selectedId === ticket.id ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{ticket.subject}</span>
                    <Badge
                      variant={ticket.status === 'CLOSED' ? 'secondary' : 'default'}
                      className="ml-auto shrink-0"
                    >
                      {tstatus(ticket.status)}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDateTime(ticket.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noTickets')}</p>
        )}

        <Pagination page={page} totalPages={ticketPage?.totalPages ?? 1} onChange={setPage} />
      </div>

      <Card className="min-h-[28rem]">
        {selectedId ? (
          <ChatThread ticketId={selectedId} className="h-[32rem]" />
        ) : (
          <>
            <CardHeader>
              <CardTitle className="text-base">{t('title')}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {/*
                Two different situations, and they used to share one line:
                having no conversations at all is not the same as having some
                and not having opened one. Neither repeats the sentence the
                left column is already showing — and neither says "left",
                which stops being true the moment the grid stacks on a phone.
              */}
              {tickets.length ? t('chooseTicket') : t('startTicket')}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
