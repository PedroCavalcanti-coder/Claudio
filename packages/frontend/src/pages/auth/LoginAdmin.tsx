import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';
import api from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { Alert } from '../../components/ui';
import LoginLayout, { LoginField, LoginSubmit, loginInputStyle, focusHandlers } from './LoginLayout';

const ACCENT = '#ef4444';
const GRADIENT = 'linear-gradient(135deg,#dc2626,#991b1b)';

export default function LoginAdmin() {
  const navigate  = useNavigate();
  const setAuth   = useAuthStore(s => s.setAuth);
  const [email, setEmail]     = useState('');
  const [pw, setPw]           = useState('');
  const [mfa, setMfa]         = useState('');
  const [showPw, setShowPw]   = useState(false);
  const [needMfa, setNeedMfa] = useState(false);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const body: Record<string, string> = { email, password: pw };
      if (mfa) body.mfa_code = mfa;
      const res = await api.post('/auth/login_admin', body);
      const { user, access_token } = res.data.data;
      setAuth(user, access_token, user.permissions ?? {});
      sessionStorage.setItem('last_login_route', '/login_admin');
      navigate('/');
    } catch (err: any) {
      if (err.response?.data?.code === 'MFA_REQUIRED') {
        setNeedMfa(true);
        setError('Informe o código MFA do seu autenticador');
      } else {
        setError(err.response?.data?.message ?? 'Credenciais inválidas');
      }
    } finally { setLoading(false); }
  }

  const fh = focusHandlers(ACCENT);

  return (
    <LoginLayout
      gradient={GRADIENT} accent={ACCENT} icon={ShieldCheck}
      title="Acesso Administrador" subtitle="Gestão global da rede municipal"
      heroTitle={<>Administre toda a<br /><span style={{ color: ACCENT }}>rede</span> em um<br />só lugar</>}
      heroText="Unidades, equipe, procedimentos e auditoria — controle completo com rastreabilidade total."
      features={['Gestão de unidades e equipe', 'Catálogo de procedimentos', 'Trilha de auditoria (LGPD)', 'Permissões granulares por usuário']}
      footerNote="Sessão expira em 15 minutos de inatividade"
      legalNote="Área restrita · Todas as ações são auditadas">
      {error && <div style={{ marginBottom: 16 }}><Alert message={error} onClose={() => setError('')} /></div>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <LoginField label="E-mail" accent={ACCENT}>
          <input style={loginInputStyle} type="email" placeholder="admin@clinica.com.br"
            value={email} onChange={e => setEmail(e.target.value)} required {...fh} />
        </LoginField>
        <LoginField label="Senha" accent={ACCENT}>
          <div style={{ position: 'relative' }}>
            <input style={{ ...loginInputStyle, paddingRight: '2.75rem' }} type={showPw ? 'text' : 'password'}
              placeholder="Senha de administrador" value={pw} onChange={e => setPw(e.target.value)} required {...fh} />
            <button type="button" onClick={() => setShowPw(p => !p)}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--sl-500)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </LoginField>
        {needMfa && (
          <LoginField label="Código MFA (6 dígitos)" accent={ACCENT}>
            <input style={{ ...loginInputStyle, textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.5em', fontFamily: 'JetBrains Mono, monospace' }}
              placeholder="000000" maxLength={6} value={mfa} onChange={e => setMfa(e.target.value.replace(/\D/g, ''))} autoFocus {...fh} />
          </LoginField>
        )}
        <LoginSubmit loading={loading} gradient={GRADIENT} />
      </form>
    </LoginLayout>
  );
}
