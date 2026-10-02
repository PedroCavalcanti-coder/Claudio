import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, UserRole } from '../types';

export type Permissions = Record<string, boolean>;

interface AuthStore {
  user:            User | null;
  accessToken:     string | null;
  permissions:     Permissions;
  isAuthenticated: boolean;
  setAuth:         (user: User, token: string, perms: Permissions) => void;
  setToken:        (token: string) => void;
  logout:          () => void;
  can:             (resource: string) => boolean;
  hasRole:         (...roles: UserRole[]) => boolean;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user:            null,
      accessToken:     null,
      permissions:     {},
      isAuthenticated: false,

      setAuth: (user, token, perms) => {
        sessionStorage.setItem('access_token', token);
        set({ user, accessToken: token, permissions: perms, isAuthenticated: true });
      },

      setToken: (token) => {
        sessionStorage.setItem('access_token', token);
        set({ accessToken: token });
      },

      logout: () => {
        sessionStorage.removeItem('access_token');
        set({ user: null, accessToken: null, permissions: {}, isAuthenticated: false });
      },

      can: (resource) => {
        const { permissions } = get();
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
        isAuthenticated: s.isAuthenticated,
      }),
    }
  )
);
