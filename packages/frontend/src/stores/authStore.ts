import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, UserRole } from '../types';

export type Permissions = Record<string, boolean>;

interface AuthStore {
  user:            User | null;
  accessToken:     string | null;
  permissions:     Permissions;
  /** Permissões granulares `recurso:ação` (mesma matriz que o backend aplica). */
  granular:        string[];
  isAuthenticated: boolean;
  setAuth:         (user: User, token: string, perms: Permissions) => void;
  setGranular:     (granular: string[]) => void;
  setToken:        (token: string) => void;
  logout:          () => void;
  /** `can('farmacia')` = tela liberada · `can('pharmacy:dispense')` = ação permitida pelo backend. */
  can:             (resource: string) => boolean;
  hasRole:         (...roles: UserRole[]) => boolean;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user:            null,
      accessToken:     null,
      permissions:     {},
      granular:        [],
      isAuthenticated: false,

      setAuth: (user, token, perms) => {
        sessionStorage.setItem('access_token', token);
        set({
          user, accessToken: token, permissions: perms, isAuthenticated: true,
          granular: user.granular_permissions ?? [],
        });
      },

      setGranular: (granular) => set({ granular }),

      setToken: (token) => {
        sessionStorage.setItem('access_token', token);
        set({ accessToken: token });
      },

      logout: () => {
        sessionStorage.removeItem('access_token');
        set({ user: null, accessToken: null, permissions: {}, granular: [], isAuthenticated: false });
      },

      can: (resource) => {
        const { permissions, granular, user } = get();
        if (resource.includes(':')) {
          if (user?.role === 'admin') return true;
          const [res] = resource.split(':');
          return granular.includes(resource) || granular.includes('*') || granular.includes(`${res}:*`);
        }
        return !!permissions[resource];
      },

      hasRole: (...roles) => {
        const { user } = get();
        return !!user && roles.includes(user.role as UserRole);
      },
    }),
    {
      name:       'ris-auth',
      partialize: (s) => ({
        user:            s.user,
        permissions:     s.permissions,
        granular:        s.granular,
        isAuthenticated: s.isAuthenticated,
      }),
    }
  )
);
