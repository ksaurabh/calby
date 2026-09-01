import { create } from 'zustand';
import type { Org, OrgInput } from '../types';
import { api } from '../utils/api';

interface OrgStore {
  orgs: Org[];
  isLoading: boolean;
  error: string | null;

  fetchOrgs: () => Promise<void>;
  createOrg: (org: OrgInput) => Promise<void>;
  updateOrg: (id: string, updates: Partial<OrgInput>) => Promise<void>;
  deleteOrg: (id: string) => Promise<void>;
}

export const useOrgStore = create<OrgStore>((set, get) => ({
  orgs: [],
  isLoading: false,
  error: null,

  fetchOrgs: async () => {
    set({ isLoading: true, error: null });
    try {
      const { orgs } = await api.listOrgs();
      set({ orgs, isLoading: false });
    } catch (e) {
      set({ error: (e as Error).message, isLoading: false });
    }
  },

  createOrg: async (org) => {
    const created = await api.createOrg(org);
    set({ orgs: [created, ...get().orgs] });
  },

  updateOrg: async (id, updates) => {
    const updated = await api.updateOrg(id, updates);
    set({ orgs: get().orgs.map(o => (o.id === id ? updated : o)) });
  },

  deleteOrg: async (id) => {
    await api.deleteOrg(id);
    set({ orgs: get().orgs.filter(o => o.id !== id) });
  },
}));
