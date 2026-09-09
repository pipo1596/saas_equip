import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';

// Locks a level-2 (Tenant Partner) session to their own tpId. Platform Admin
// (level 1) sessions are unrestricted and can act as any partner. A level-2
// user navigating (or deep-linking) to a different :id under /partner/ is
// redirected back to their own partner's dashboard instead.
export const partnerTenantGuard: CanActivateChildFn = (childRoute) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isPartnerLogin()) return true;

  const authorizedTpId = auth.tpId();
  if (authorizedTpId == null) {
    return router.createUrlTree(['/login']);
  }

  const requestedTpId = Number(childRoute.paramMap.get('id'));
  if (requestedTpId === authorizedTpId) return true;

  return router.createUrlTree(['/partner', authorizedTpId, 'dashboard']);
};
