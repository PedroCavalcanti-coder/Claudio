import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Eye, EyeOff } from 'lucide-react';
import api from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { Alert } from '../../components/ui';
import LoginLayout, { LoginField, LoginSubmit, loginInputStyle, focusHandlers } from './LoginLayout';

const ACCENT = '#22d3ee';
const GRADIENT = 'linear-gradient(135deg,#0891b2,#0e7490)';

export default function LoginTecnico() {
  const navigate  = useNavigate();
  const setAuth   = useAuthStore(s => s.setAuth);
  const [username, setUsername] = useState('');
  const [pw, setPw]             = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const fh = focusHandlers(ACCENT);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await api.post('/auth/login_tecnico', { username, password: pw });
      const { user, access_token } = res.data.data;
      setAuth(user, access_token, user.permissions ?? {});
      sessionStorage.setItem('last_login_route', '/login_tecnico');
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Usuário ou senha inválidos');
    } finally { setLoading(false); }
  }

  return (
    <LoginLayout
      gradient={GRADIENT} accent={ACCENT} icon={Activity}
      title="Acesso Técnico" subtitle="Entre com seu usuário e senha"
      heroTitle={<>Imagens prontas<br />para o <span style={{ color: ACCENT }}>laudo</span></>}
      heroText="Gerencie a worklist, faça o upload de exames e acompanhe a produção da unidade."
      features={['Worklist do dia em tempo real', 'Upload de DICOM em blocos', 'Check-in e atendimento avulso', 'Visualizador OrthoVis integrado']}
      legalNote="Acesso restrito à equipe técnica">
      {error && <div style={{ marginBottom: 16 }}><Alert message={error} onClose={() => setError('')} /></div>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <LoginField label="Usuário" accent={ACCENT}>
          <input style={loginInputStyle} placeholder="seu.usuario" value={username}
            onChange={e => setUsername(e.target.value)} required autoFocus {...fh} />
        </LoginField>
        <LoginField label="Senha" accent={ACCENT}>
          <div style={{ position: 'relative' }}>
            <input style={{ ...loginInputStyle, paddingRight: '2.75rem' }} type={showPw ? 'text' : 'password'}
              placeholder="Sua senha" value={pw} onChange={e => setPw(e.target.value)} required {...fh} />
            <button type="button" onClick={() => setShowPw(p => !p)}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--sl-500)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </LoginField>
        <LoginSubmit loading={loading} gradient={GRADIENT} />
      </form>
    </LoginLayout>
  );
}
