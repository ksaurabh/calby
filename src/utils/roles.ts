import type { Role } from '../types';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  user: 'Member',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: 'Full access: manage organizations, allowed domains, and user roles.',
  admin: 'Manage any organization and view users.',
  user: 'Create organizations and manage the ones you created.',
};
