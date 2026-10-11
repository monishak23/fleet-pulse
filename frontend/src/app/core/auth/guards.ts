import { inject } from '@angular/core';
import { CanActivateFn, CanDeactivateFn, Router } from '@angular/router';
import { AuthService } from './service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.isAuthenticated()
    ? true
    : inject(Router).createUrlTree(['/login'], {
        queryParams: { returnUrl: state.url },
      });
};

export const operatorGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (!auth.isAuthenticated()) {
    return inject(Router).createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }
  return auth.canEdit() ? true : inject(Router).createUrlTree(['/']);
};

export const unsavedChangesGuard: CanDeactivateFn<{
  canDeactivate: () => boolean;
}> = (component) => {
  const auth = inject(AuthService);
  return !auth.isAuthenticated() || component.canDeactivate();
};
