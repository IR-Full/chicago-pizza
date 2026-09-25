import type { Order, OrderStatus, Role } from '@/shared/api/types';

/** Mirrors the server-side state machine so the UI only offers legal moves. */
const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['ON_DELIVERY', 'CANCELLED'],
  ON_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

/**
 * ...and mirrors `OrderService.staffMayWrite` on top of it. A courier may
 * pick up an unclaimed delivery and finish their own; the kitchen queue and
 * cancellations belong to the administrator. Offering buttons the server
 * answers 403 to is how a board teaches its users to ignore error toasts.
 */
export function movesFor(order: Order, actor?: { id: string; role: Role } | null): OrderStatus[] {
  const legal = NEXT_STATUSES[order.status];
  if (!actor || actor.role === 'ADMIN') return legal;
  if (actor.role !== 'COURIER') return [];

  return legal.filter((next) => {
    if (next === 'ON_DELIVERY') return !order.courierId || order.courierId === actor.id;
    if (next === 'DELIVERED') return order.courierId === actor.id;
    return false;
  });
}
