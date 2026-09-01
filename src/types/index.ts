export type Role = 'user' | 'admin' | 'super_admin';

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain?: string;
  role: Role;
  createdAt?: string;
  createdBy?: string;
  lastLoginAt?: string | null;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  domain: string;
  /** First person on the org's domain to sign in after it was created. */
  adminEmail: string | null;
  adminClaimedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgInput {
  name: string;
  domain?: string;
}
