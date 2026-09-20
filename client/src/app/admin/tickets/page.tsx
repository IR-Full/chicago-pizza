'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { TicketStatus } from '@/shared/api/types';
import { useFormatters } from '@/shared/lib/use-formatters';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent } from '@/shared/ui/card';
import { Pagination } from '@/shared/ui/pagination';
import { Skeleton } from '@/shared/ui/skeleton';
import { adminApi } from '@/features/admin/api';
import { ChatThread } from '@/widgets/support-chat/chat-thread';

const FILTERS: (TicketStatus | 'ALL')[] = ['ALL', 'OPEN', 'IN_PROGRESS', 'CLOSED'];

export default function AdminTicketsPage() {
  const t = useTranslations('admin');
  const tstatus = useTranslations('support.status');
  const { formatDateTime } = useFormatters();

  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'ALL'>('OPEN');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'tickets', statusFilter, page],
    queryFn: () => adminApi.listTickets(page, statusFilter === 'ALL' ? undefined : statusFilter),
    refetchInterval: 30_000,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => {
                setStatusFilter(status);
                setPage(1);
              }}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                statusFilter === status ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              {status === 'ALL' ? t('tickets') : tstatus(status)}
            </button>
          ))}
        </div>

        {isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <ul className="space-y-2">
            {data?.items.map((ticket) => (
              <li key={ticket.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(ticket.id)}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left text-sm transition-colors',
                    selectedId === ticket.id ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{ticket.subject}</span>
                    <Badge variant={ticket.status === 'CLOSED' ? 'secondary' : 'default'} className="ml-auto">
                      {tstatus(ticket.status)}
                    </Badge>
                  </div>
                  <p className="truncate text-muted-foreground">
                    {ticket.user?.firstName} · {formatDateTime(ticket.updatedAt)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        <Pagination page={page} totalPages={data?.totalPages ?? 1} onChange={setPage} />
      </div>

      <Card className="min-h-[32rem]">
        {selectedId ? (
          <ChatThread ticketId={selectedId} className="h-[34rem]" />
        ) : (
          <CardContent className="p-6 text-sm text-muted-foreground">{t('tickets')}</CardContent>
        )}
      </Card>
    </div>
  );
}
