import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { authApi } from '../../api/endpoints';
import { useAuthStore } from '../../stores/authStore';
import { Alert, Field, Spinner } from '../../components/ui';
import { getErrorMessage } from '../../utils/format';

const strong = (p: string) => p.length >= 8 && /[A-Z]/.test(p) && /[0-9]/.test(p);

/**
 * Troca da PRÓPRIA senha. Obrigatória no primeiro acesso (senha provisória entregue pelo
 * administrador) — enquanto `must_change_password` estiver ativo o backend barra o resto da API.
 */
export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const forced = !!user?.must_change_password;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = current && strong(next) && next === confirm && next !== current;

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const res = await authApi.changePassword(current, next);
      const token = (res.data as any)?.data?.access_token as string | undefined;
      if (token) useAuthStore.getState().setToken(token);
      if (user) useAuthStore.setState({ user: { ...user, must_change_password: false } });
      navigate('/', { replace: true });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--navy-950)' }}>
      <div className="card p-6 w-full max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-accent-subtle)', color: 'var(--cyan-500)' }}>
            <KeyRound size={18} />
          </div>
          <div>
            <h1 className="font-display font-bold text-lg text-slate-100">{forced ? 'Defina sua senha' : 'Trocar senha'}</h1>
            <p className="text-slate-500 text-xs">
              {forced ? 'Você entrou com uma senha provisória. Escolha uma senha só sua para continuar.' : 'Informe a senha atual e escolha a nova.'}
            </p>
          </div>
        </div>
        {error && <Alert message={error} onClose={() => setError('')} />}
        <Field label="Senha atual" required>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} autoFocus />
        </Field>
        <Field label="Nova senha" required>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)}
            placeholder="Mínimo 8 caracteres, 1 maiúscula e 1 número" />
        </Field>
        <Field label="Repita a nova senha" required>
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && valid && !busy) submit(); }} />
        </Field>
        {next && !strong(next) && <p className="text-xs" style={{ color: 'var(--color-warning)' }}>A senha precisa de 8+ caracteres, 1 maiúscula e 1 número.</p>}
        {confirm && next !== confirm && <p className="text-xs" style={{ color: 'var(--color-warning)' }}>As senhas não coincidem.</p>}
        <div className="flex gap-3 justify-end pt-2">
          {!forced && <button className="btn-ghost" onClick={() => navigate(-1)}>Cancelar</button>}
          <button className="btn-primary" disabled={!valid || busy} onClick={submit}>
            {busy ? <Spinner size={14} /> : 'Salvar nova senha'}
          </button>
        </div>
      </div>
    </div>
  );
}
