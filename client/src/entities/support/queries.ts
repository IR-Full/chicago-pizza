'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/entities/user/queries';
import { supportApi } from './api';

export const supportKeys = {
  tickets: ['support', 'tickets'] as const,
  ticket: (id: string) => ['support', 'ticket', id] as const,
  notifications: ['notifications'] as const,
};

export function useTickets() {
  const { data: user } = useCurrentUser();
  return useQuery({ queryKey: supportKeys.tickets, queryFn: supportApi.listTickets, enabled: !!user });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: supportKeys.ticket(id),
    queryFn: () => supportApi.getTicket(id),
    enabled: !!id,
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      subject,
      message,
      channel,
    }: {
      subject: string;
      message: string;
      channel?: 'CHAT' | 'TICKET';
    }) => supportApi.createTicket(subject, message, channel),
    onSuccess: () => qc.invalidateQueries({ queryKey: supportKeys.tickets }),
  });
}

export function useSendTicketMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, message }: { ticketId: string; message: string }) =>
      supportApi.addMessage(ticketId, message),
    // The socket broadcast also arrives, but refetching keeps the thread
    // authoritative even if the socket dropped.
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: supportKeys.ticket(variables.ticketId) }),
  });
}

export function useCloseTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => supportApi.closeTicket(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: supportKeys.ticket(id) });
      qc.invalidateQueries({ queryKey: supportKeys.tickets });
    },
  });
}

export function useNotifications() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: supportKeys.notifications,
    queryFn: () => supportApi.notifications(),
    enabled: !!user,
    // The socket ping is the fast path; this is the safety net for a client
    // that reconnected while the ping was in flight.
    refetchInterval: 5 * 60_000,
  });
}

/** Marks one notification read, or the whole list when called with nothing. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) => supportApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: supportKeys.notifications }),
  });
}
