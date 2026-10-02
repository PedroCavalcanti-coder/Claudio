import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Eye, EyeOff, Loader2, ArrowRight, CheckCircle } from 'lucide-react';
import api from '../../api/client';
import { Alert } from '../../components/ui';

/**
 * Redefinição de senha via token enviado por e-mail (/reset-password?token=…).
 * O backend exige senha forte: mínimo 8 caracteres, 1 maiúscula e 1 número.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [params]  = useSearchParams();
  const token     = params.get('token') ?? '';

  const [pw, setPw]         = useState('');
  const [pw2, setPw2]       = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone]     = useState(false);

  const strong = pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw);
  const match  = pw === pw2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!strong) { setError('Senha fraca: mínimo 8 caracteres, com 1 maiúscula e 1 número.'); return; }
    if (!match)  { setError('As senhas não coincidem.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password: pw });
      setDone(true);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Não foi possível redefinir a senha. O link pode ter expirado.');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg,#020810,#050d1c,#030912)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)' }}>
            <KeyRound size={26} className="text-white" />
          </div>
          <h2 className="font-display font-bold text-2xl text-white">Redefinir senha</h2>
          <p className="text-slate-400 text-sm mt-1">Crie uma nova senha de acesso</p>
        </div>

        <div className="rounded-2xl p-7 space-y-5 shadow-2xl"
          style={{ background: 'rgba(8,15,28,0.9)', border: '1px solid rgba(8,145,178,0.2)' }}>

          {!token ? (
            <Alert message="Link inválido: token ausente. Solicite uma nova redefinição." />
          ) : done ? (
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <CheckCircle size={40} className="text-emerald-400" />
              <p className="text-slate-100 font-medium">Senha redefinida com sucesso!</p>
              <p className="text-slate-400 text-sm">Você já pode entrar com a nova senha.</p>
              <button className="btn-primary mt-2" onClick={() => navigate('/login_admin')}>
                Ir para o login <ArrowRight size={15} />
              </button>
            </div>
          ) : (
            <>
              {error && <Alert message={error} onClose={() => setError('')} />}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">Nova senha</label>
                  <div className="relative">
                    <input className="input pr-10" type={showPw ? 'text' : 'password'}
                      placeholder="Mínimo 8 caracteres" value={pw}
                      onChange={e => setPw(e.target.value)} required autoFocus />
                    <button type="button" onClick={() => setShowPw(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <p className={`text-xs mt-1 ${strong ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {strong ? '✓ Senha forte' : 'Mínimo 8 caracteres, 1 maiúscula e 1 número'}
                  </p>
                </div>
                <div>
                  <label className="label">Confirmar nova senha</label>
                  <input className="input" type={showPw ? 'text' : 'password'}
                    placeholder="Repita a senha" value={pw2}
                    onChange={e => setPw2(e.target.value)} required />
                  {pw2 && !match && <p className="text-xs mt-1 text-red-400">As senhas não coincidem</p>}
                </div>

                <button type="submit" disabled={loading || !strong || !match}
                  className="w-full py-3 rounded-xl font-display font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', boxShadow: '0 0 20px rgba(8,145,178,0.3)' }}>
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <><span>Redefinir senha</span><ArrowRight size={16} /></>}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-700 mt-4 font-mono">
          O link de redefinição expira em 1 hora
        </p>
      </div>
    </div>
  );
}
