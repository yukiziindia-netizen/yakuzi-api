import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      console.log('[DEBUG-ROLES] Unauthorized: No authenticated user found');
      throw new ForbiddenException('No authenticated user found');
    }

    console.log('[DEBUG-ROLES] Path:', context.switchToHttp().getRequest().url);
    console.log('[DEBUG-ROLES] User Role:', user.role);
    console.log('[DEBUG-ROLES] Required Roles:', requiredRoles);

    const hasRole = requiredRoles.some((role) => user.role === role);

    if (!hasRole) {
      console.log('[DEBUG-ROLES] Forbidden: User role mismatch');
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    }

    return true;
  }
}
