export type Role = 'user' | 'admin' | 'super_admin';

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  domain?: string;
  role: Role;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  domain: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgInput {
  name: string;
  domain?: string;
}
