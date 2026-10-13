/**
 * Input rules shared by the gateway DTOs (which the browser hits) and the
 * microservice DTOs (defence in depth). They used to be three copies of the
 * same regex that had already drifted apart — the gateway answered in Russian
 * and the auth service in English, so which language the customer saw depended
 * on which validation ran first.
 *
 * The client mirrors these in `src/features/auth/model/schemas.ts`; keep the
 * two in step.
 */

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt silently truncates anything past 72 bytes. */
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_PATTERN = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
export const PASSWORD_RULE_MESSAGE = 'Пароль должен содержать строчные и заглавные буквы и цифру';

export const PHONE_PATTERN = /^\+7\d{10}$/;
export const PHONE_RULE_MESSAGE = 'Телефон должен быть в формате +7XXXXXXXXXX';

export const NAME_MAX_LENGTH = 50;
export const VERIFICATION_CODE_LENGTH = 6;

export const TICKET_SUBJECT_MIN_LENGTH = 3;
export const TICKET_SUBJECT_MAX_LENGTH = 150;
export const TICKET_MESSAGE_MAX_LENGTH = 2000;

/*
 * There is no MAX_ADDED_INGREDIENTS. Paid extra toppings were built, capped
 * and validated, but the pizzeria does not sell them — the whole path was
 * removed rather than left switched off.
 */

/** Removals are bounded by the recipe, but the array still needs a ceiling. */
export const MAX_REMOVED_INGREDIENTS = 15;

export const COMMENT_MAX_LENGTH = 500;
export const PROMOCODE_MAX_LENGTH = 50;

/**
 * How many of one configured line may be ordered at once.
 *
 * The cart clamps to it and the DTO rejects past it, so `PricingService`'s own
 * check is the last line rather than the first: a quantity this far out is a
 * tampered request, not a customer's mistake.
 */
export const MAX_LINE_QUANTITY = 50;
