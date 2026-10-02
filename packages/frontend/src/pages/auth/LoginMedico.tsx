import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stethoscope, Eye, EyeOff } from 'lucide-react';
import api from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { Alert } from '../../components/ui';
import LoginLayout, { LoginField, LoginSubmit, loginInputStyle, focusHandlers } from './LoginLayout';

const ACCENT = '#8b5cf6';
const GRADIENT = 'linear-gradient(135deg,#7c3aed,#4c1d95)';

export default function LoginMedico() {
  const navigate  = useNavigate();
  const setAuth   = useAuthStore(s => s.setAuth);
  const [cpf, setCpf]     = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw]       = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const fh = focusHandlers(ACCENT);

  function formatCpf(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await api.post('/auth/login_medico', { cpf: cpf.replace(/\D/g,''), email, password: pw });
      const { user, access_token } = res.data.data;
      setAuth(user, access_token, user.permissions ?? {});
      sessionStorage.setItem('last_login_route', '/login_medico');
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Credenciais inválidas');
    } finally { setLoading(false); }
  }

  return (
    <LoginLayout
      gradient={GRADIENT} accent={ACCENT} icon={Stethoscope}
      title="Acesso Médico" subtitle="Entre com CPF e e-mail institucional"
      heroTitle={<>Laudos e imagens<br /><span style={{ color: ACCENT }}>na palma</span> da<br />sua mão</>}
      heroText="Acompanhe os exames que você solicitou e acesse laudos assinados com segurança."
      features={['Exames solicitados em um só lugar', 'Laudos assinados digitalmente', 'Encaminhamentos entre unidades', 'Notificações de resultados']}
      legalNote="Acesso restrito a profissionais cadastrados">
      {error && <div style={{ marginBottom: 16 }}><Alert message={error} onClose={() => setError('')} /></div>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <LoginField label="CPF" accent={ACCENT}>
          <input style={loginInputStyle} placeholder="000.000.000-00" value={cpf}
            onChange={e => setCpf(formatCpf(e.target.value))} required {...fh} />
        </LoginField>
        <LoginField label="E-mail institucional" accent={ACCENT}>
          <input style={loginInputStyle} type="email" placeholder="medico@clinica.com.br" value={email}
            onChange={e => setEmail(e.target.value)} required {...fh} />
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
