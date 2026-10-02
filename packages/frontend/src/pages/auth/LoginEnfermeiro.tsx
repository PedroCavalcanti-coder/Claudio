import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Syringe, Eye, EyeOff } from 'lucide-react';
import api from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { Alert } from '../../components/ui';
import LoginLayout, { LoginField, LoginSubmit, loginInputStyle, focusHandlers } from './LoginLayout';

const ACCENT = '#f43f5e';
const GRADIENT = 'linear-gradient(135deg,#e11d48,#9f1239)';

export default function LoginEnfermeiro() {
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
      const res = await api.post('/auth/login_enfermeiro', { username, password: pw });
      const { user, access_token } = res.data.data;
      setAuth(user, access_token, user.permissions ?? {});
      sessionStorage.setItem('last_login_route', '/login_enfermeiro');
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Usuário ou senha inválidos');
    } finally { setLoading(false); }
  }

  return (
    <LoginLayout
      gradient={GRADIENT} accent={ACCENT} icon={Syringe}
      title="Acesso Enfermagem" subtitle="Entre com seu usuário e senha"
      heroTitle={<>Cuidado<br /><span style={{ color: ACCENT }}>na ponta</span></>}
      heroText="Administre medicamentos prescritos na unidade e registre as medições dos pacientes."
      features={['Fila de medicação na unidade', 'Registro de administração (MAR)', 'Medições e sinais vitais', 'Acesso ao prontuário do paciente']}
      legalNote="Acesso restrito à equipe de enfermagem">
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
