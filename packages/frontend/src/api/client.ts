import axios, { AxiosError } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export const api = axios.create({
  baseURL:         BASE_URL,
  withCredentials: true,    // envia cookie de refresh_token automaticamente
  timeout:         30_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = sessionStorage.getItem('access_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshing = false;
let waitQueue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Não tenta refresh em:
    //   - endpoints de login (401 = credencial errada, não sessão expirada)
    //   - endpoints do portal do paciente (usam X-Portal-Token, não Bearer JWT de staff)
    const isLoginEndpoint  = original.url?.includes('/auth/login');
    const isPortalEndpoint = original.url?.includes('/patient-portal/');
    if (error.response?.status === 401 && !original._retry && !isLoginEndpoint && !isPortalEndpoint && original.url !== '/auth/refresh') {
      if (refreshing) {
        return new Promise((resolve) => {
          waitQueue.push((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }

      original._retry = true;
      refreshing = true;

      try {
        const { data } = await api.post('/auth/refresh');
        const newToken = data.data.access_token;
        sessionStorage.setItem('access_token', newToken);
        waitQueue.forEach((cb) => cb(newToken));
        waitQueue = [];
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        sessionStorage.removeItem('access_token');
        // Redireciona para o login mais recente que o usuário usou, ou admin como fallback
        const lastLogin = sessionStorage.getItem('last_login_route') ?? '/login_admin';
        window.location.href = lastLogin;
        return Promise.reject(error);
      } finally {
        refreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.message ?? err.message;
  }
  return 'Erro inesperado';
}

export default api;
