import { Role } from '@chicago-pizza/prisma';

/**
 * Declared as a type alias rather than an interface on purpose: `signAsync`
 * accepts jsonwebtoken's own payload type, which carries an index signature.
 * TypeScript gives object *type aliases* an implicit index signature but
 * never interfaces, so an interface here failed to match the overload.
 */
export type JwtPayload = {
  sub: string; // userId
  email: string;
  role: Role;
  /** Issued-at, seconds since epoch. Set by the signer; used to honour session revocation. */
  iat?: number;
  /** Expiry, seconds since epoch. Set by the signer. */
  exp?: number;
};

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
