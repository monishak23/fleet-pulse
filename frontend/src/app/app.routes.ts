import { Routes } from '@angular/router';
import { authGuard, operatorGuard, unsavedChangesGuard } from './core/auth/guards';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in · Fleet Pulse',
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: '',
    pathMatch: 'full',
    title: 'Fleet · Fleet Pulse',
    canActivate: [authGuard],
    loadComponent: () => import('./features/fleet-table/fleet-table').then((m) => m.FleetTable),
  },
  {
    path: 'services/:id',
    title: 'Service · Fleet Pulse',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/service-detail/service-detail').then((m) => m.ServiceDetail),
  },
  {
    path: 'rules',
    title: 'Alert rules · Fleet Pulse',
    canActivate: [operatorGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/rules/rules').then((m) => m.Rules),
  },
  {
    path: 'settings',
    title: 'Settings · Fleet Pulse',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: '' },
];
