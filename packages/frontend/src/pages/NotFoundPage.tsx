/**
 * NotFoundPage — fallback para URLs sem rota correspondente.
 *
 * Comportamento:
 *   - Não-autenticado          → vai pra tela de login (paciente, padrão público)
 *   - Autenticado interno      → mostra 404 com botão "Voltar ao Dashboard"
 *   - Paciente autenticado     → vai pro portal
 */
import { Link, Navigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export default function NotFoundPage() {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated)            return <Navigate to="/login_paciente" replace />;
  if (user?.role === 'patient')    return <Navigate to="/portal_do_paciente" replace />;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--navy-950)',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 420,
          textAlign: 'center',
          background: 'var(--navy-900)',
          border: '1px solid var(--navy-700)',
          borderRadius: 16,
          padding: '40px 32px',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div
          style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--color-warning-bg)',
            color: 'var(--color-warning)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <AlertTriangle size={24} />
        </div>

        <h1 className="font-display font-bold text-2xl text-slate-100" style={{ marginBottom: 8 }}>
          404 — Página não encontrada
        </h1>
        <p className="text-slate-500 text-sm" style={{ marginBottom: 24 }}>
          A URL que você tentou acessar não existe ou foi movida.
        </p>

        <Link to="/dashboard" className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
          Voltar ao Dashboard
        </Link>
      </div>
    </div>
  );
}
