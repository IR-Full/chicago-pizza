import { z } from 'zod';

/**
 * Mirrors the server-side validation rules. Client validation is a UX
 * affordance only — the gateway re-validates every field.
 */
const passwordSchema = z
  .string()
  .min(8, 'passwordTooShort')
  .max(72)
  .regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'passwordWeak');

export const loginSchema = z.object({
  email: z.string().min(1, 'required').email('invalidEmail'),
  password: z.string().min(1, 'required'),
});

export const registerSchema = z.object({
  email: z.string().min(1, 'required').email('invalidEmail'),
  password: passwordSchema,
  firstName: z.string().min(1, 'required').max(50),
  lastName: z.string().max(50).optional().or(z.literal('')),
  phone: z
    .string()
    .regex(/^\+7\d{10}$/, 'invalidPhone')
    .optional()
    .or(z.literal('')),
  referralCode: z.string().optional().or(z.literal('')),
});

export const verifyEmailSchema = z.object({
  code: z.string().length(6, 'codeLength'),
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
