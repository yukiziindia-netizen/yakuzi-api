import 'reflect-metadata';
import { WishlistController } from './wishlist.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

/**
 * Saving an item was restricted to accounts with the BUYER role, while the
 * storefront showed the bookmark icon to every signed-in visitor. An admin or
 * seller browsing the shop got "You do not have permission to access this
 * resource" and the save was silently lost — the storefront stops writing the
 * browser copy once signed in, so there was nothing to fall back to.
 *
 * These guard the shape of the fix, because it is the kind of line that gets
 * "tidied" back in by someone pattern-matching the controllers around it.
 */
describe('WishlistController access', () => {
  it('is open to any signed-in user, not one role', () => {
    const controllerRoles = Reflect.getMetadata(ROLES_KEY, WishlistController);
    expect(controllerRoles).toBeUndefined();
  });

  it('puts no role restriction on any individual route either', () => {
    for (const method of ['list', 'add', 'merge', 'remove'] as const) {
      const handler = (WishlistController.prototype as never as Record<string, unknown>)[
        method
      ];
      expect(handler).toBeDefined();
      expect(Reflect.getMetadata(ROLES_KEY, handler as object)).toBeUndefined();
    }
  });

  it('still requires a signed-in user — this is per-account data', () => {
    // The guard list is what keeps a wishlist attached to one account. Losing
    // it would make these routes anonymous, which is a much worse bug than
    // the one being fixed.
    const guards = Reflect.getMetadata('__guards__', WishlistController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
  });
});
