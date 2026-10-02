import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import type { UserRole } from '../../types';
import { ShieldOff } from 'lucide-react';

interface Props {
  resource?:   string;
  roles?:      UserRole[];
  children:    React.ReactNode;
  fallback?:   'redirect' | 'block' | 'hide';
  redirectTo?: string;
}

export default function RoleGuard({
  resource, roles, children,
  fallback = 'redirect', redirectTo = '/dashboard',
}: Props) {
  const { can, hasRole, isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) return <Navigate to="/login_paciente" replace />;

  // Paciente não tem acesso ao sistema interno
  if (user?.role === 'patient') return <Navigate to="/portal_do_paciente" replace />;

  const allowed =
    (resource !== undefined ? can(resource) : true) &&
    (roles     !== undefined ? hasRole(...roles) : true);

  if (allowed) return <>{children}</>;
  if (fallback === 'hide')     return null;
  if (fallback === 'redirect') return <Navigate to={redirectTo} replace />;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 animate-fade-in">
      <div className="w-16 h-16 rounded-2xl bg-red-950/30 border border-red-800/40
                      flex items-center justify-center">
        <ShieldOff size={28} className="text-red-400" />
      </div>
      <div className="text-center max-w-sm">
        <h2 className="font-display font-semibold text-slate-100 text-lg mb-2">
          Acesso Restrito
        </h2>
        <p className="text-slate-400 text-sm">
          Você não tem permissão para acessar este módulo.
          Fale com o administrador do sistema se acredita que isso é um erro.
        </p>
      </div>
    </div>
  );
}
