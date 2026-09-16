import { api } from '@/shared/api/api-client';
import type { Notification, Paginated, SupportTicket, TicketMessage } from '@/shared/api/types';

export const supportApi = {
  createTicket: (subject: string, message: string, channel: 'CHAT' | 'TICKET' = 'TICKET') =>
    api.post<SupportTicket>('/support/tickets', { subject, message, channel }),
  listTickets: () => api.get<SupportTicket[]>('/support/tickets'),
  getTicket: (id: string) => api.get<SupportTicket>(`/support/tickets/${id}`),
  addMessage: (id: string, message: string) =>
    api.post<TicketMessage>(`/support/tickets/${id}/messages`, { message }),
  closeTicket: (id: string) => api.patch<SupportTicket>(`/support/tickets/${id}/close`),

  notifications: (page = 1) =>
    api.get<Paginated<Notification> & { unread: number }>('/notifications', { query: { page } }),
  markRead: (id?: string) => api.patch<{ success: boolean }>('/notifications/read', undefined, { query: { id } }),
};
