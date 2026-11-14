import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';

/**
 * Postorizon Phase 6 — the decision half of PlatformAdminGuard, kept
 * pure so it can be unit-executed. The flag is read from the DB user
 * row AuthMiddleware put on the request — never from token claims.
 */
export const isPlatformAdminUser = (
  user?: { isPlatformAdmin?: boolean } | null
): boolean => !!user?.isPlatformAdmin;

/**
 * Gates every route of PlatformAdminController (@Controller('/admin')).
 * Runs after AuthMiddleware, which has already authenticated the
 * request and resolved the DB user onto `req.user`. Refusals mirror
 * the existing AdminController.assertSuperAdmin idiom
 * (HttpException 'Unauthorized', 400).
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!isPlatformAdminUser(request.user)) {
      throw new HttpException('Unauthorized', 400);
    }
    return true;
  }
}
