'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import type { TicketMessage } from '@/shared/api/types';
import { ApiError } from '@/shared/api/api-client';
import { WS_EVENTS } from '@/shared/api/socket';
import { useSocketEvent, useSocketRoom } from '@/shared/lib/use-socket-event';
import { formatTime } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { supportKeys, useSendTicketMessage, useTicket } from '@/entities/support/queries';
import { useCurrentUser } from '@/entities/user/queries';

export function ChatThread({ ticketId, className }: { ticketId: string; className?: string }) {
  const t = useTranslations('support');
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();
  const { data: ticket } = useTicket(ticketId);
  const sendMessage = useSendTicketMessage();

  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useSocketRoom('ticket:subscribe', ticketId ? { ticketId } : null);

  useSocketEvent<{ ticketId: string; message: TicketMessage }>(WS_EVENTS.TICKET_MESSAGE, (payload) => {
    if (payload.ticketId !== ticketId) return;
    qc.invalidateQueries({ queryKey: supportKeys.ticket(ticketId) });
  });

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ticket?.messages.length]);

  const isClosed = ticket?.status === 'CLOSED';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;

    setDraft('');
    try {
      await sendMessage.mutateAsync({ ticketId, message });
    } catch (error) {
      setDraft(message); // restore the draft so nothing is lost
      toast.error(error instanceof ApiError ? error.message : 'Сообщение не отправлено');
    }
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex-1 space-y-3 overflow-y-auto p-1">
        {ticket?.messages.map((message) => {
          const isMine = message.senderId === user?.id;
          return (
            <div key={message.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                  isMine ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted',
                )}
              >
                {!isMine ? (
                  <p className="mb-0.5 text-xs font-semibold opacity-70">
                    {message.sender?.firstName ?? 'Chicago Pizza'}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words">{message.message}</p>
                <p className={cn('mt-0.5 text-[10px]', isMine ? 'opacity-70' : 'text-muted-foreground')}>
                  {formatTime(message.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {isClosed ? (
        <p className="border-t p-3 text-center text-sm text-muted-foreground">{t('ticketClosed')}</p>
      ) : (
        <form onSubmit={submit} className="flex gap-2 border-t p-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('chatPlaceholder')}
            aria-label={t('message')}
          />
          <Button type="submit" size="icon" disabled={!draft.trim()} aria-label={t('send')}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      )}
    </div>
  );
}
