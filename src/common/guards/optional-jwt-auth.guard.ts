import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Attaches request.user when a valid JWT is presented, but never rejects the
 * request — public routes use this to behave differently for admins
 * (e.g. blog drafts) without requiring authentication.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser | null {
    return user || null;
  }
}
