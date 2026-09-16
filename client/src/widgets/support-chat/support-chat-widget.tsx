'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MessageCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/api-client';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { useCreateTicket, useTickets } from '@/entities/support/queries';
import { useCurrentUser } from '@/entities/user/queries';
import { ChatThread } from './chat-thread';

/**
 * Floating live-chat launcher. Reuses the ticket system: a chat conversation
 * is just a ticket with channel=CHAT, so support staff see one unified inbox.
 */
export function SupportChatWidget() {
  const t = useTranslations('support');
  const pathname = usePathname();
  const { data: user } = useCurrentUser();
  const { data: tickets = [] } = useTickets();
  const createTicket = useCreateTicket();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  // The dedicated support page and the admin panel have their own chat UI.
  const hidden = !user || pathname.startsWith('/support') || pathname.startsWith('/admin');
  if (hidden) return null;

  const activeChat = tickets.find((ticket) => ticket.channel === 'CHAT' && ticket.status !== 'CLOSED');

  async function startChat(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;

    try {
      await createTicket.mutateAsync({ subject: 'Онлайн-чат', message, channel: 'CHAT' });
      setDraft('');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось начать чат');
    }
  }

  return (
    <>
      {open ? (
        <div className="fixed bottom-20 right-4 z-50 flex h-[28rem] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-card bg-card shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="font-heading font-black">{t('title')}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {activeChat ? (
            <ChatThread ticketId={activeChat.id} className="flex-1 overflow-hidden" />
          ) : (
            <form onSubmit={startChat} className="flex flex-1 flex-col justify-end gap-2 p-4">
              <p className="text-sm text-muted-foreground">{t('chatPlaceholder')}</p>
              <div className="flex gap-2">
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('message')} />
                <Button type="submit" disabled={!draft.trim()} loading={createTicket.isPending}>
                  {t('send')}
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}

      <Button
        size="icon"
        className="fixed bottom-4 right-4 z-50 h-14 w-14 rounded-full shadow-lg"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('title')}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </Button>
    </>
  );
}
