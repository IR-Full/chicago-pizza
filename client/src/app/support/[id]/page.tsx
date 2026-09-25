import { SupportInbox } from '@/widgets/support-inbox/support-inbox';

/**
 * A single support thread, opened straight from the "you have a reply" email.
 *
 * It renders the same inbox as `/support` with that ticket selected, so the
 * customer keeps the list beside it instead of landing on an orphaned thread.
 */
export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  // Async since Next 15.
  const { id } = await params;

  return <SupportInbox initialTicketId={id} />;
}
