import { Prisma } from '@chicago-pizza/prisma';

export async function recordOrderEvent(
  tx: Prisma.TransactionClient,
  event: string,
  payload: Record<string, unknown>,
) {
  await tx.eventOutbox.createMany({
    data: ['notifications', 'realtime'].map((destination) => ({
      event,
      destination,
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
    })),
  });
}
