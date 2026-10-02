import { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';

function hasPortalSession(): boolean {
  return !!(sessionStorage.getItem('portal_token') && sessionStorage.getItem('portal_patient'));
}
import { Shield, Eye, EyeOff, FileText, Loader2, ArrowRight, CheckCircle, RotateCcw, UserX } from 'lucide-react';
import api from '../../api/client';
import { Alert } from '../../components/ui';
import ThemeToggle from '../../components/ui/ThemeToggle';

const FEATURES = [
  'Laudos assinados digitalmente',
  'Visualizador de imagens médicas',
  'Status em tempo real do exame',
  'Histórico completo de atendimentos',
];

export default function LoginPaciente() {
  const navigate  = useNavigate();
  const [cpf, setCpf]       = useState('');
  const [pw, setPw]         = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  // Estado de "conta inativa" — backend devolveu code='ACCOUNT_INACTIVE'.
  // Mantemos cpf/pw em memória pra reativar com 1 clique (já foram validados).
  const [inactive, setInactive] = useState<{ patient_name: string } | null>(null);
  const [reactivating, setReactivating] = useState(false);

  // pageshow cobre o bfcache: ao voltar via botão "voltar", o navegador restaura um snapshot
  // congelado sem re-rodar o React, então um redirect só em render/useEffect não dispara.
  useEffect(() => {
    const onShow = () => {
      if (hasPortalSession()) window.location.replace('/portal_do_paciente');
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

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
      const res  = await api.post('/auth/login_paciente', { cpf: cpf.replace(/\D/g,''), password: pw });
      const data = res.data.data;

      // Conta inativa — backend devolve credenciais válidas mas sem token.
      if (data?.code === 'ACCOUNT_INACTIVE') {
        setInactive({ patient_name: data.patient_name ?? 'Paciente' });
        return;
      }

      sessionStorage.setItem('portal_token',   data.token);
      sessionStorage.setItem('portal_patient', JSON.stringify(data.patient));
      navigate('/portal_do_paciente', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'CPF ou senha inválidos');
    } finally { setLoading(false); }
  }

  async function handleReactivate() {
    setError(''); setReactivating(true);
    try {
      const res  = await api.post('/auth/reactivate_paciente', { cpf: cpf.replace(/\D/g,''), password: pw });
      const data = res.data.data;
      sessionStorage.setItem('portal_token',   data.token);
      sessionStorage.setItem('portal_patient', JSON.stringify(data.patient));
      navigate('/portal_do_paciente', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Falha ao reativar a conta');
    } finally { setReactivating(false); }
  }

  function cancelReactivation() {
    setInactive(null);
    setError('');
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.625rem 0.875rem',
    borderRadius: '0.625rem',
    border: '1.5px solid var(--navy-700)',
    background: 'var(--navy-900)',
    color: 'var(--sl-200)',
    fontSize: '0.9375rem',
    fontFamily: 'Outfit, sans-serif',
    outline: 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  };

  // Já logado: redireciona em tempo de render (sem flash do formulário).
  if (hasPortalSession()) return <Navigate to="/portal_do_paciente" replace />;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        background: 'var(--navy-950)',
        backgroundImage: 'var(--page-gradient)',
      }}
    >
      <div
        className="hidden lg:flex lg:w-[46%] flex-col justify-between p-14 relative overflow-hidden"
        style={{
          background: 'var(--navy-900)',
          borderRight: '1px solid var(--navy-700)',
        }}
      >
        <div
          style={{
            position: 'absolute', inset: 0, opacity: 0.03,
            backgroundImage: 'radial-gradient(circle, var(--cyan-500) 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }}
        />

        <div className="relative z-10 flex items-center gap-3">
          <div
            style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'linear-gradient(135deg, var(--cyan-500), var(--navy-600))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px var(--color-accent-ring)',
            }}
          >
            <Shield size={18} color="white" strokeWidth={2.5} />
          </div>
          <div>
            <p style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: 18, color: 'var(--sl-100)', letterSpacing: '-0.02em' }}>
              RIS/PACS
            </p>
            <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'var(--sl-500)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              SISTEMA CLÍNICO
            </p>
          </div>
        </div>

        <div className="relative z-10">
          <h1 style={{ fontFamily: 'Instrument Serif, serif', fontSize: 44, fontWeight: 400, lineHeight: 1.15, color: 'var(--sl-100)', letterSpacing: '-0.01em', marginBottom: 16 }}>
            Acompanhe seus<br />
            <span style={{ color: 'var(--color-accent)' }}>exames</span> em<br />
            tempo real
          </h1>
          <p style={{ color: 'var(--sl-400)', fontSize: 15, lineHeight: 1.7, maxWidth: 340, marginBottom: 32 }}>
            Acesse laudos, imagens médicas e seu histórico completo de forma segura.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FEATURES.map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-accent-subtle)', border: '1px solid var(--color-accent-ring)' }}>
                  <CheckCircle size={11} color="var(--color-accent)" strokeWidth={2.5} />
                </div>
                <span style={{ fontSize: 13, color: 'var(--sl-400)' }}>{f}</span>
              </div>
            ))}
          </div>
        </div>

        <p style={{ position: 'relative', zIndex: 10, fontSize: 11, color: 'var(--sl-600)', fontFamily: 'JetBrains Mono, monospace' }}>
          Dados protegidos · LGPD · ANVISA RDC 611/2022
        </p>
      </div>

      <div
        style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '32px 24px',
        }}
      >
        <div style={{ position: 'absolute', top: 16, right: 16 }}>
          <ThemeToggle compact />
        </div>

        <div className="flex lg:hidden items-center gap-2 mb-8">
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--cyan-500), var(--navy-600))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={14} color="white" />
          </div>
          <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 16, color: 'var(--sl-100)' }}>RIS/PACS</span>
        </div>

        <div style={{ width: '100%', maxWidth: 400 }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div
              style={{
                width: 56, height: 56, borderRadius: 16, margin: '0 auto 14px',
                background: 'linear-gradient(135deg, var(--cyan-500), var(--navy-600))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 24px var(--color-accent-ring)',
              }}
            >
              <FileText size={24} color="white" />
            </div>
            <h2 style={{ fontFamily: 'Instrument Serif, serif', fontSize: 26, fontWeight: 400, color: 'var(--sl-100)', marginBottom: 6, letterSpacing: '-0.01em' }}>
              Portal do Paciente
            </h2>
            <p style={{ fontSize: 13, color: 'var(--sl-500)' }}>Acesse com seu CPF e senha</p>
          </div>

          <div
            style={{
              borderRadius: 16, padding: '28px 28px',
              background: 'var(--navy-900)',
              border: '1.5px solid var(--navy-700)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {error && <div style={{ marginBottom: 16 }}><Alert message={error} onClose={() => setError('')} /></div>}

            {inactive ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                  padding: '16px 12px',
                  background: 'var(--color-warning-bg)',
                  border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
                  borderRadius: 12,
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: 'var(--color-warning-bg)',
                    border: '2px solid var(--color-warning)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <UserX size={20} color="var(--color-warning)" strokeWidth={2.2} />
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{
                      fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 15,
                      color: 'var(--color-warning)', marginBottom: 4,
                    }}>
                      Olá, {inactive.patient_name}
                    </p>
                    <p style={{ fontSize: 13, color: 'var(--sl-300)', lineHeight: 1.5 }}>
                      Sua conta foi <strong>inativada</strong>. Seus dados continuam preservados.
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--sl-500)', marginTop: 6, lineHeight: 1.5 }}>
                      Para voltar a acessar o portal, reative sua conta agora.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleReactivate}
                  disabled={reactivating}
                  style={{
                    width: '100%', padding: '0.75rem',
                    borderRadius: 10,
                    fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 14,
                    background: reactivating ? 'var(--navy-700)' : 'var(--color-accent)',
                    color: reactivating ? 'var(--sl-500)' : 'var(--color-accent-text)',
                    border: 'none', cursor: reactivating ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={e => { if (!reactivating) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-accent-hover)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = reactivating ? 'var(--navy-700)' : 'var(--color-accent)'; }}
                >
                  {reactivating
                    ? <><Loader2 size={16} className="animate-spin" /> Reativando…</>
                    : <><RotateCcw size={15} /> Reativar minha conta</>
                  }
                </button>

                <button
                  type="button"
                  onClick={cancelReactivation}
                  disabled={reactivating}
                  style={{
                    width: '100%', padding: '0.5rem',
                    background: 'transparent', border: 'none',
                    color: 'var(--sl-500)', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  Cancelar e voltar
                </button>
              </div>
            ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--sl-500)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>CPF</label>
                <input
                  style={inputStyle}
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={e => setCpf(formatCpf(e.target.value))}
                  required
                  onFocus={e => { e.target.style.borderColor = 'var(--color-accent)'; e.target.style.boxShadow = '0 0 0 3px var(--color-accent-ring)'; }}
                  onBlur={e => { e.target.style.borderColor = 'var(--navy-700)'; e.target.style.boxShadow = 'none'; }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--sl-500)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Senha</label>
                <div style={{ position: 'relative' }}>
                  <input
                    style={{ ...inputStyle, paddingRight: '2.75rem' }}
                    type={showPw ? 'text' : 'password'}
                    placeholder="Sua senha de acesso"
                    value={pw}
                    onChange={e => setPw(e.target.value)}
                    required
                    onFocus={e => { e.target.style.borderColor = 'var(--color-accent)'; e.target.style.boxShadow = '0 0 0 3px var(--color-accent-ring)'; }}
                    onBlur={e => { e.target.style.borderColor = 'var(--navy-700)'; e.target.style.boxShadow = 'none'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(p => !p)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--sl-500)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '0.75rem',
                  borderRadius: 10,
                  fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 14,
                  background: loading ? 'var(--navy-700)' : 'var(--color-accent)',
                  color: loading ? 'var(--sl-500)' : 'var(--color-accent-text)',
                  border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  marginTop: 4,
                  transition: 'background-color 0.15s ease, transform 0.1s ease',
                  opacity: loading ? 0.6 : 1,
                }}
                onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-accent-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = loading ? 'var(--navy-700)' : 'var(--color-accent)'; }}
              >
                {loading
                  ? <><Loader2 size={16} className="animate-spin" /> Entrando…</>
                  : <><span>Entrar</span><ArrowRight size={15} /></>
                }
              </button>
            </form>
            )}

            {!inactive && (
              <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--sl-600)', marginTop: 16 }}>
                Senha criada na recepção no dia do exame
              </p>
            )}
          </div>

          <p style={{ textAlign: 'center', fontSize: 10, color: 'var(--sl-700)', marginTop: 20, fontFamily: 'JetBrains Mono, monospace' }}>
            Acesso restrito a pacientes · LGPD Art. 11
          </p>
        </div>
      </div>
    </div>
  );
}
