import { Role } from '@chicago-pizza/prisma';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
