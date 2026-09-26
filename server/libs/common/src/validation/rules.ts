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

/**
 * How many extras may go on one pizza.
 *
 * A real ceiling, not a guess at what is sensible: the kitchen will not build
 * a pizza with every topping in the menu on it. The constructor has to stop
 * offering extras at this number — it used to let the customer pick all
 * twenty, then the price call came back 400 and the "add to cart" button
 * simply greyed out with nothing said.
 */
export const MAX_ADDED_INGREDIENTS = 15;

/** Removals are bounded by the recipe, but the array still needs a ceiling. */
export const MAX_REMOVED_INGREDIENTS = 15;

export const COMMENT_MAX_LENGTH = 500;
export const PROMOCODE_MAX_LENGTH = 50;
