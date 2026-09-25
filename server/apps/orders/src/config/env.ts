import { z } from 'zod';
import { baseEnvSchema } from '@chicago-pizza/common';

/**
 * Payment credentials are optional on purpose.
 *
 * Without them online payment is not offered, the checkout refuses it, and
 * paying the courier carries on as the only option — a shop without a merchant
 * account still boots and still takes orders.
 */
export const ordersEnvSchema = baseEnvSchema.extend({
  YOOKASSA_SHOP_ID: z.string().optional(),
  YOOKASSA_SECRET_KEY: z.string().optional(),
});
