import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, Users, Upload, Monitor, Users2,
  FileImage, FileText, Activity, ClipboardList, Syringe,
  LogOut, ChevronRight, Zap, Building2, FlaskConical, ShieldCheck, Send, ScrollText, Settings2,
  Tv, ExternalLink, BarChart3, Pill, Video,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../api/endpoints';
import type { UserRole } from '../../types';

interface NavItem {
  to:         string;
  icon:       React.ElementType;
  label:      string;
  resource?:     string;
  divider?:      boolean;
  adminOnly?:    boolean;
  nonAdminOnly?: boolean;   // some para admin, que usa a versão dedicada do recurso (ex.: /admin/units)
  external?:     boolean;   // abre em nova aba — usado por telas de exibição (ex.: painel de TV) que ficam em tela cheia
}

const NAV_ITEMS: NavItem[] = [
  { to:'/admin',           icon:ShieldCheck,     label:'Painel Admin',     resource:'settings', adminOnly:true },
  { to:'/admin/units',     icon:Building2,       label:'Unidades',         resource:'settings', adminOnly:true },
  { to:'/admin/staff',     icon:Users2,          label:'Equipe',           resource:'settings', adminOnly:true },
  { to:'/admin/audit',     icon:ScrollText,      label:'Auditoria',        resource:'settings', adminOnly:true },
  { divider:true, to:'', icon:LayoutDashboard, label:'', adminOnly:true },

  { to:'/dashboard',       icon:LayoutDashboard, label:'Dashboard',        resource:'dashboard'          },
  { divider:true, to:'', icon:LayoutDashboard, label:'' },
  { to:'/appointments',    icon:Calendar,        label:'Agendamento',      resource:'appointments'       },
  { to:'/atendimento',     icon:ClipboardList,   label:'Atendimento',      resource:'atendimento'        },
  { to:'/painel',          icon:Tv,              label:'Painel TV',        resource:'painel', external:true },
  { to:'/medicacao',       icon:Syringe,         label:'Medicação',        resource:'medicacao'          },
  { to:'/farmacia',        icon:Pill,            label:'Farmácia',         resource:'farmacia'           },
  { to:'/teleconsulta',    icon:Video,           label:'Teleconsulta',     resource:'teleconsulta'       },
  { to:'/patients',        icon:Users,           label:'Pacientes',        resource:'patients_read'      },
  { to:'/worklist',        icon:Activity,        label:'Worklist',         resource:'worklist'           },
  { to:'/minha-unidade',   icon:Settings2,       label:'Minha Unidade',    resource:'unit_manage', nonAdminOnly:true },
  { divider:true, to:'', icon:LayoutDashboard, label:'' },
  { to:'/studies',         icon:FileImage,       label:'Estudos',          resource:'studies'            },
  { to:'/dicom-upload',    icon:Upload,          label:'Upload DICOM',     resource:'dicom_upload'       },
  { to:'/webviewer',       icon:Monitor,         label:'Visualizador',     resource:'webviewer'          },
  { to:'/procedures',      icon:FlaskConical,    label:'Procedimentos',    resource:'procedures_manage'  },
  { divider:true, to:'', icon:LayoutDashboard, label:'' },
  { to:'/reports',         icon:FileText,        label:'Laudos',           resource:'reports'            },
  { to:'/second-opinion',  icon:Users2,          label:'Conselho Técnico', resource:'second_opinion'     },
  { to:'/referrals',       icon:Send,            label:'Encaminhamentos',  resource:'referrals'          },
  { to:'/relatorios',      icon:BarChart3,       label:'Relatórios',       resource:'relatorios'         },
];

const ROLE_BADGE: Record<UserRole, { label:string; color:string; bg:string }> = {
  admin:        { label:'Admin',        color:'#EF4444', bg:'rgba(239,68,68,0.1)'   },
  radiologist:  { label:'Radiologista', color:'var(--cyan-500)', bg:'var(--color-accent-subtle)' },
  technician:   { label:'Técnico',      color:'#818CF8', bg:'rgba(129,140,248,0.1)' },
  receptionist: { label:'Recepção',     color:'var(--color-success)', bg:'var(--color-success-bg)' },
  doctor:       { label:'Médico',       color:'var(--color-warning)', bg:'var(--color-warning-bg)' },
  nurse:        { label:'Enfermeiro',   color:'#f43f5e', bg:'rgba(244,63,94,0.1)' },
  patient:      { label:'Paciente',     color:'var(--sl-500)', bg:'var(--navy-800)' },
};

export default function Sidebar({ onClose }: { onClose?: () => void } = {}) {
  const { user, logout, can } = useAuthStore();
  const navigate = useNavigate();
  const role     = user?.role as UserRole | undefined;
  const badge    = role ? ROLE_BADGE[role] : null;

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* segue com o logout local mesmo se a chamada ao servidor falhar */ }
    logout();
    navigate('/login_paciente');
    onClose?.();
  };

  const visible = NAV_ITEMS.filter(item => {
    if (item.adminOnly && role !== 'admin') return false;
    if (item.nonAdminOnly && role === 'admin') return false;
    if (item.divider) return true;
    if (!item.resource) return true;
    return can(item.resource);
  });

  const filtered = visible.filter((item, idx, arr) => {
    if (!item.divider) return true;
    const prev = arr[idx - 1];
    const next = arr[idx + 1];
    if (!prev || !next)               return false;
    if (prev.divider || next.divider) return false;
    return true;
  });

  return (
    <aside
      style={{
        width: '228px',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'sticky',
        top: 0,
        transition: 'background-color 0.2s ease, border-color 0.2s ease',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          padding: '16px 16px 12px',
          borderBottom: '1px solid var(--sidebar-border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <div
            style={{
              width: 30, height: 30,
              borderRadius: 8,
              background: 'linear-gradient(135deg, var(--cyan-500), var(--navy-500))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px var(--color-accent-ring)',
              flexShrink: 0,
            }}
          >
            <Zap size={14} color="white" strokeWidth={2.5} />
          </div>
          <div>
            <p style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 14, color: 'var(--sl-200)', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
              RIS/PACS
            </p>
            <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'var(--sl-500)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 1 }}>
              SISTEMA CLÍNICO
            </p>
          </div>
        </div>

        {user?.health_unit_name ? (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 9px',
              borderRadius: 6,
              background: 'var(--navy-800)',
              border: '1px solid var(--navy-700)',
            }}
          >
            <Building2 size={10} color="var(--sl-500)" />
            <span style={{ fontSize: 10, color: 'var(--sl-500)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.health_unit_name}
            </span>
          </div>
        ) : user?.role === 'admin' ? (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 9px',
              borderRadius: 6,
              background: 'rgba(239,68,68,0.07)',
              border: '1px solid rgba(239,68,68,0.2)',
            }}
          >
            <Building2 size={10} color="#EF4444" />
            <span style={{ fontSize: 10, color: '#EF4444', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.04em' }}>
              Acesso Global
            </span>
          </div>
        ) : null}
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {filtered.map((item, idx) => {
          if (item.divider) {
            return (
              <div key={`div-${idx}`} style={{ height: 1, background: 'var(--sidebar-border)', margin: '5px 4px' }} />
            );
          }
          if (item.external) {
            return (
              <a
                key={item.to}
                href={item.to}
                target="_blank"
                rel="noreferrer"
                onClick={onClose}
                className="sidebar-link"
              >
                <item.icon size={15} strokeWidth={1.8} />
                <span style={{ flex: 1, fontSize: 13 }}>{item.label}</span>
                <ExternalLink size={10} style={{ opacity: 0.4 }} />
              </a>
            );
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            >
              <item.icon size={15} strokeWidth={1.8} />
              <span style={{ flex: 1, fontSize: 13 }}>{item.label}</span>
              <ChevronRight size={10} style={{ opacity: 0.3 }} />
            </NavLink>
          );
        })}
      </nav>

      <div
        style={{
          padding: '10px',
          borderTop: '1px solid var(--sidebar-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 10px',
            borderRadius: 8,
            background: 'var(--navy-800)',
            border: '1px solid var(--navy-700)',
          }}
        >
          <div
            style={{
              width: 30, height: 30,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
              color: 'var(--color-accent-text)', flexShrink: 0,
            }}
          >
            {user?.name?.charAt(0).toUpperCase()}
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--sl-200)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
              {user?.name}
            </p>
            {badge && (
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', padding: '1px 6px', borderRadius: 99, display: 'inline-block', marginTop: 2, background: badge.bg, color: badge.color, fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>
                {badge.label}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="sidebar-link"
          style={{
            color: 'var(--sl-400)',
            justifyContent: 'center',
            marginTop: 2,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color           = 'var(--color-danger)';
            e.currentTarget.style.backgroundColor = 'var(--color-danger-bg)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color           = 'var(--sl-400)';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <LogOut size={14} />
          <span style={{ fontSize: 13 }}>Sair</span>
        </button>
      </div>
    </aside>
  );
}
