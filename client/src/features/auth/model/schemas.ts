import { z } from 'zod';

/**
 * Mirrors `server/libs/common/src/validation/rules.ts` — keep the two in step.
 * Client validation is a UX affordance only: the gateway re-validates every
 * field, and its message (in Russian) wins if the two ever disagree.
 *
 * The numbers are inlined rather than imported because the server is a
 * separate package; the constants there carry the same values.
 */
const PASSWORD_MIN_LENGTH = 8;
/** bcrypt silently truncates anything past 72 bytes. */
const PASSWORD_MAX_LENGTH = 72;
const PASSWORD_PATTERN = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
const PHONE_PATTERN = /^\+7\d{10}$/;
const NAME_MAX_LENGTH = 50;
const VERIFICATION_CODE_LENGTH = 6;

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'passwordTooShort')
  .max(PASSWORD_MAX_LENGTH)
  .regex(PASSWORD_PATTERN, 'passwordWeak');

export const loginSchema = z.object({
  email: z.string().min(1, 'required').email('invalidEmail'),
  password: z.string().min(1, 'required'),
});

export const registerSchema = z.object({
  email: z.string().min(1, 'required').email('invalidEmail'),
  password: passwordSchema,
  firstName: z.string().min(1, 'required').max(NAME_MAX_LENGTH),
  lastName: z.string().max(NAME_MAX_LENGTH).optional().or(z.literal('')),
  phone: z
    .string()
    .regex(PHONE_PATTERN, 'invalidPhone')
    .optional()
    .or(z.literal('')),
  referralCode: z.string().optional().or(z.literal('')),
  // 152-ФЗ: the agreement has to be given, not assumed. `literal(true)` is
  // what makes an unticked box a validation error rather than a silent
  // `false` the server then rejects with a less helpful message.
  acceptPrivacyPolicy: z.literal(true, {
    errorMap: () => ({ message: 'consentRequired' }),
  }),
});

export const verifyEmailSchema = z.object({
  code: z.string().length(VERIFICATION_CODE_LENGTH, 'codeLength'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'required').email('invalidEmail'),
});

export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type VerifyEmailValues = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
