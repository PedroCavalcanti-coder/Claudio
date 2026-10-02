import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, Search } from 'lucide-react';
import Sidebar from './Sidebar';
import NotificationsPanel from '../../pages/notifications/NotificationsPanel';
import ThemeToggle from '../ui/ThemeToggle';
import GlobalSearch from '../GlobalSearch';

const TITLES: Record<string, string> = {
  '/dashboard':      'Dashboard',
  '/patients':       'Pacientes',
  '/appointments':   'Agendamento',
  '/worklist':       'Worklist',
  '/studies':        'Estudos DICOM',
  '/reports':        'Laudos',
  '/admin':          'Administração da Rede',
  '/admin/units':    'Unidades de Saúde',
  '/admin/staff':    'Equipe da Rede',
  '/admin/audit':    'Auditoria',
  '/referrals':      'Encaminhamentos',
  '/dicom-upload':   'Upload DICOM',
  '/webviewer':      'Visualizador DICOM',
  '/second-opinion': 'Conselho Técnico',
  '/procedures':     'Procedimentos',
};

export default function AppLayout() {
  const location = useLocation();
  const title    = TITLES[location.pathname] ?? 'RIS/PACS';
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { document.title = `${title} · RIS/PACS`; }, [title]);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--navy-950)' }}>

      {/* Pular para o conteúdo (a11y — visível só com foco de teclado) */}
      <a href="#main-content" className="skip-link">Pular para o conteúdo</a>

      {/* Busca global de paciente (Ctrl/Cmd+K) */}
      <GlobalSearch />

      {/* Sidebar — fixa no desktop, drawer no mobile */}
      <div className={`ris-sidebar-wrap ${mobileOpen ? 'open' : ''}`}>
        <Sidebar onClose={() => setMobileOpen(false)} />
      </div>
      {mobileOpen && (
        <div className="ris-sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        <header
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 20px',
            height: 52,
            borderBottom: '1px solid var(--navy-700)',
            background: 'var(--navy-900)',
            flexShrink: 0,
            transition: 'background-color 0.2s ease, border-color 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Hambúrguer — só no mobile (abre o drawer) */}
            <button
              className="ris-mobile-menu-btn"
              aria-label="Abrir menu"
              onClick={() => setMobileOpen(true)}
              style={{ color: 'var(--sl-300)', display: 'none' }}
            >
              <Menu size={18} />
            </button>
            <h1
              style={{
                fontFamily: 'Outfit, sans-serif',
                fontWeight: 600, fontSize: 14,
                color: 'var(--sl-200)',
                letterSpacing: '-0.005em',
              }}
            >
              {title}
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => window.dispatchEvent(new Event('open-global-search'))}
              title="Buscar paciente (Ctrl/Cmd + K)" aria-label="Buscar paciente"
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 border border-navy-600 rounded-md px-2 py-1.5"
            >
              <Search size={14} /> Buscar
              <kbd className="text-[10px] text-slate-500 border border-navy-600 rounded px-1">Ctrl K</kbd>
            </button>
            <ThemeToggle />
            <NotificationsPanel />
          </div>
        </header>

        <main id="main-content" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <div
            style={{ maxWidth: 1280, margin: '0 auto' }}
            className="animate-fade-in p-4 sm:p-6"
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
