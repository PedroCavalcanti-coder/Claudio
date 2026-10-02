import { Link } from 'react-router-dom';
import { CheckCircle, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import ThemeToggle from '../../components/ui/ThemeToggle';

export interface LoginLayoutProps {
  gradient: string;
  accent:   string;
  icon:     React.ElementType;
  title:    string;
  subtitle: string;
  heroTitle:   React.ReactNode;
  heroText:    string;
  features:    string[];
  footerNote?: string;
  legalNote?:  string;
  children:    React.ReactNode;
}

// Layout único compartilhado por todos os perfis de login, para manter a mesma qualidade visual variando só cor/ícone/texto.
export default function LoginLayout({
  gradient, accent, icon: Icon, title, subtitle,
  heroTitle, heroText, features, footerNote, legalNote, children,
}: LoginLayoutProps) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--navy-950)', backgroundImage: 'var(--page-gradient)' }}>
      <div className="hidden lg:flex lg:w-[46%] flex-col justify-between p-14 relative overflow-hidden"
        style={{ background: 'var(--navy-900)', borderRight: '1px solid var(--navy-700)' }}>
        <div style={{ position:'absolute', inset:0, opacity:0.03,
          backgroundImage:'radial-gradient(circle, var(--cyan-500) 1px, transparent 0)', backgroundSize:'32px 32px' }} />

        <div className="relative z-10 flex items-center gap-3">
          <div style={{ width:40, height:40, borderRadius:12, background:gradient,
            display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 16px rgba(0,0,0,0.3)' }}>
            <Icon size={18} color="white" strokeWidth={2.5} />
          </div>
          <div>
            <p style={{ fontFamily:'Outfit, sans-serif', fontWeight:800, fontSize:18, color:'var(--sl-100)', letterSpacing:'-0.02em' }}>RIS/PACS</p>
            <p style={{ fontFamily:'JetBrains Mono, monospace', fontSize:9, color:'var(--sl-500)', letterSpacing:'0.14em', textTransform:'uppercase' }}>SISTEMA CLÍNICO</p>
          </div>
        </div>

        <div className="relative z-10">
          <h1 style={{ fontFamily:'Instrument Serif, serif', fontSize:44, fontWeight:400, lineHeight:1.15, color:'var(--sl-100)', letterSpacing:'-0.01em', marginBottom:16 }}>
            {heroTitle}
          </h1>
          <p style={{ color:'var(--sl-400)', fontSize:15, lineHeight:1.7, maxWidth:340, marginBottom:32 }}>{heroText}</p>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {features.map(f => (
              <div key={f} style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:20, height:20, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                  background:`color-mix(in srgb, ${accent} 14%, transparent)`, border:`1px solid color-mix(in srgb, ${accent} 30%, transparent)` }}>
                  <CheckCircle size={11} color={accent} strokeWidth={2.5} />
                </div>
                <span style={{ fontSize:13, color:'var(--sl-400)' }}>{f}</span>
              </div>
            ))}
          </div>
        </div>

        <p style={{ position:'relative', zIndex:10, fontSize:11, color:'var(--sl-600)', fontFamily:'JetBrains Mono, monospace' }}>
          Dados protegidos · LGPD · ANVISA RDC 611/2022
        </p>
      </div>

      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 24px', position:'relative' }}>
        <div style={{ position:'absolute', top:16, right:16 }}><ThemeToggle compact /></div>

        <div className="flex lg:hidden items-center gap-2 mb-8">
          <div style={{ width:32, height:32, borderRadius:8, background:gradient, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Icon size={14} color="white" />
          </div>
          <span style={{ fontFamily:'Outfit, sans-serif', fontWeight:700, fontSize:16, color:'var(--sl-100)' }}>RIS/PACS</span>
        </div>

        <div style={{ width:'100%', maxWidth:400 }}>
          <div style={{ textAlign:'center', marginBottom:28 }}>
            <div style={{ width:56, height:56, borderRadius:16, margin:'0 auto 14px', background:gradient,
              display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 8px 24px rgba(0,0,0,0.35)' }}>
              <Icon size={24} color="white" />
            </div>
            <h2 style={{ fontFamily:'Instrument Serif, serif', fontSize:26, fontWeight:400, color:'var(--sl-100)', marginBottom:6, letterSpacing:'-0.01em' }}>{title}</h2>
            <p style={{ fontSize:13, color:'var(--sl-500)' }}>{subtitle}</p>
          </div>

          <div style={{ borderRadius:16, padding:'28px', background:'var(--navy-900)', border:'1.5px solid var(--navy-700)', boxShadow:'var(--shadow-lg)' }}>
            {children}
            {footerNote && (
              <p style={{ textAlign:'center', fontSize:11, color:'var(--sl-600)', marginTop:16 }}>{footerNote}</p>
            )}
          </div>

          <div style={{ textAlign:'center', marginTop:16 }}>
            <Link to="/login_paciente" style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:'var(--sl-500)', textDecoration:'none' }}>
              <ArrowLeft size={13} /> Outro tipo de acesso
            </Link>
          </div>

          {legalNote && (
            <p style={{ textAlign:'center', fontSize:10, color:'var(--sl-700)', marginTop:14, fontFamily:'JetBrains Mono, monospace' }}>{legalNote}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function LoginField({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) {
  void accent;
  return (
    <div>
      <label style={{ display:'block', fontSize:11, fontWeight:600, color:'var(--sl-500)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:6 }}>{label}</label>
      {children}
    </div>
  );
}

export const loginInputStyle: React.CSSProperties = {
  width:'100%', padding:'0.625rem 0.875rem', borderRadius:'0.625rem',
  border:'1.5px solid var(--navy-700)', background:'var(--navy-900)', color:'var(--sl-200)',
  fontSize:'0.9375rem', fontFamily:'Outfit, sans-serif', outline:'none',
  transition:'border-color 0.15s ease, box-shadow 0.15s ease',
};

export const focusHandlers = (accent: string) => ({
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => { e.target.style.borderColor = accent; e.target.style.boxShadow = `0 0 0 3px color-mix(in srgb, ${accent} 22%, transparent)`; },
  onBlur:  (e: React.FocusEvent<HTMLInputElement>) => { e.target.style.borderColor = 'var(--navy-700)'; e.target.style.boxShadow = 'none'; },
});

export function LoginSubmit({ loading, gradient, label = 'Entrar' }: { loading: boolean; gradient: string; label?: string }) {
  return (
    <button type="submit" disabled={loading}
      style={{ width:'100%', padding:'0.75rem', borderRadius:10, fontFamily:'Outfit, sans-serif', fontWeight:700, fontSize:14,
        background: loading ? 'var(--navy-700)' : gradient, color:'#fff', border:'none', cursor: loading ? 'not-allowed' : 'pointer',
        display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginTop:4, opacity: loading ? 0.7 : 1, transition:'opacity 0.15s ease' }}>
      {loading ? <><Loader2 size={16} className="animate-spin" /> Entrando…</> : <><span>{label}</span><ArrowRight size={15} /></>}
    </button>
  );
}
