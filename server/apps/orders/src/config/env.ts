import { z } from 'zod';
import { baseEnvSchema } from '@chicago-pizza/common';

/**
 * Payment credentials are optional on purpose.
 *
 * Without them online payment is not offered, the checkout refuses it, and
 * paying the courier carries on as the only option — a shop without a merchant
 * account still boots and still takes orders.
 */
export const ordersEnvSchema = baseEnvSchema
  .extend({
    YOOKASSA_SHOP_ID: z.string().trim().optional(),
    YOOKASSA_SECRET_KEY: z.string().trim().optional(),
    YOOKASSA_RECEIPT_ENABLED: z.enum(['true', 'false']).default('false'),
    YOOKASSA_VAT_CODE: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.coerce.number().int().min(1).max(12).optional(),
    ),
    YOOKASSA_TAX_SYSTEM_CODE: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.coerce.number().int().min(1).max(6).optional(),
    ),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.YOOKASSA_SHOP_ID) !== Boolean(env.YOOKASSA_SECRET_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Укажите оба реквизита ЮKassa или оставьте оба пустыми',
      });
    }
    if (env.YOOKASSA_RECEIPT_ENABLED === 'true' && !env.YOOKASSA_VAT_CODE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Для чеков укажите YOOKASSA_VAT_CODE' });
    }
  });
