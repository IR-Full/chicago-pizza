'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import type { Role, TicketMessage } from '@/shared/api/types';
import { ApiError } from '@/shared/api/api-client';
import { WS_EVENTS } from '@/shared/api/socket';
import { useSocketEvent, useSocketRoom } from '@/shared/lib/use-socket-event';
import { useFormatters } from '@/shared/lib/use-formatters';
import { cn } from '@/shared/lib/cn';
import { newIdempotencyKey } from '@/shared/lib/idempotency';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { StoredText } from '@/shared/ui/stored-text';
import { supportKeys, useSendTicketMessage, useTicket } from '@/entities/support/queries';
import { useCurrentUser } from '@/entities/user/queries';

/** Who counts as the shop rather than the customer. */
const STAFF_ROLES: Role[] = ['ADMIN', 'SUPPORT'];

/**
 * Which side of the thread a message belongs on.
 *
 * By *party*, not by account: comparing `senderId` to the viewer's id looked
 * right in the customer's own inbox and fell apart everywhere else. In the
 * admin panel a reply written by a colleague rendered as if the customer had
 * sent it, and an operator reading a ticket they had opened themselves saw
 * their own two roles collapse into one colour on one side.
 *
 * The shop is always on the viewer's side when the viewer works here, and the
 * customer is always on it when they do not.
 */
function isSameSide(senderRole: Role, viewerRole: Role | undefined): boolean {
  const senderIsStaff = STAFF_ROLES.includes(senderRole);
  const viewerIsStaff = viewerRole ? STAFF_ROLES.includes(viewerRole) : false;
  return senderIsStaff === viewerIsStaff;
}

export function ChatThread({ ticketId, className }: { ticketId: string; className?: string }) {
  const t = useTranslations('support');
  const { formatTime } = useFormatters();
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();
  const { data: ticket } = useTicket(ticketId);
  const sendMessage = useSendTicketMessage();

  const [draft, setDraft] = useState('');
  const sendingRef = useRef(false);
  const attemptRef = useRef<{ ticketId: string; message: string; id: string } | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useSocketRoom('ticket:subscribe', ticketId ? { ticketId } : null);

  useSocketEvent<{ ticketId: string; message: TicketMessage }>(WS_EVENTS.TICKET_MESSAGE, (payload) => {
    if (payload.ticketId !== ticketId) return;
    qc.invalidateQueries({ queryKey: supportKeys.ticket(ticketId) });
  });

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [ticket?.messages.length]);

  const isClosed = ticket?.status === 'CLOSED';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sendingRef.current || sendMessage.isPending) return;
    sendingRef.current = true;
    if (attemptRef.current?.ticketId !== ticketId || attemptRef.current.message !== message) {
      attemptRef.current = { ticketId, message, id: newIdempotencyKey() };
    }

    setDraft('');
    try {
      await sendMessage.mutateAsync({ ticketId, message, clientMessageId: attemptRef.current.id });
      attemptRef.current = null;
    } catch (error) {
      setDraft(message); // restore the draft so nothing is lost
      toast.error(error instanceof ApiError ? error.message : 'Сообщение не отправлено');
    } finally {
      sendingRef.current = false;
    }
  }

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-col', className)}>
      {ticket?.subject ? (
        <div className="shrink-0 border-b px-3 py-2">
          <h2 className="break-words text-sm font-semibold">
            <StoredText text={ticket.subject} kind="subject" />
          </h2>
        </div>
      ) : null}
      <div ref={messagesRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-1">
        {ticket?.messages.map((message) => {
          const isMine = isSameSide(message.senderRole, user?.role);
          return (
            <div key={message.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'min-w-0 max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                  isMine ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted',
                )}
              >
                {!isMine ? (
                  <p className="mb-0.5 text-xs font-semibold opacity-70">
                    <StoredText
                      kind="name"
                      text={
                        STAFF_ROLES.includes(message.senderRole)
                          ? (message.sender?.firstName ?? t('supportName'))
                          : (message.sender?.firstName ?? t('customerName'))
                      }
                    />
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  <StoredText text={message.message} />
                </p>
                <p className={cn('mt-0.5 text-[10px]', isMine ? 'opacity-70' : 'text-muted-foreground')}>
                  {formatTime(message.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {isClosed ? (
        <p className="border-t p-3 text-center text-sm text-muted-foreground">{t('ticketClosed')}</p>
      ) : (
        <form onSubmit={submit} className="flex gap-2 border-t p-3">
          <Input
            className="min-w-0 flex-1"
            disabled={sendMessage.isPending}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('chatPlaceholder')}
            aria-label={t('message')}
          />
          <Button
            type="submit"
            size="icon"
            className="shrink-0"
            loading={sendMessage.isPending}
            disabled={!draft.trim()}
            aria-label={t('send')}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      )}
    </div>
  );
}
