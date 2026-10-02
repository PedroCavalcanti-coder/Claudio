/**
 * Aviso de consentimento de cookies (LGPD — Lei 13.709/2018).
 *
 * Fixado no canto inferior da tela até o usuário decidir. A escolha fica
 * persistida em localStorage; enquanto não houver decisão, o banner aparece.
 * Monte uma única vez no root (App.tsx), fora das rotas.
 */
import { useState } from 'react';
import { Cookie, X } from 'lucide-react';

const STORAGE_KEY = 'ris-cookie-consent';
type CookieChoice = 'accepted' | 'rejected';

function getCookieConsent(): CookieChoice | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'accepted' || v === 'rejected' ? v : null;
  } catch {
    return null;
  }
}

export default function CookieConsent() {
  // Só mostra se ainda não houve decisão registrada (lido na inicialização).
  const [visible, setVisible] = useState(() => getCookieConsent() === null);

  function decide(choice: CookieChoice) {
    try { localStorage.setItem(STORAGE_KEY, choice); } catch { /* storage indisponível */ }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Aviso de cookies"
      style={{
        position: 'fixed',
        left: 16,
        bottom: 16,
        zIndex: 300,
        maxWidth: 420,
        width: 'calc(100% - 32px)',
        background: 'var(--navy-900)',
        border: '1px solid var(--navy-700)',
        borderRadius: 12,
        padding: '16px 18px',
        boxShadow: 'var(--shadow-xl)',
        animation: 'slideUp 0.25s ease',
      }}
    >
      <button
        aria-label="Fechar aviso de cookies"
        onClick={() => decide('rejected')}
        style={{
          position: 'absolute', top: 10, right: 10,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--sl-500)', opacity: 0.7,
        }}
      >
        <X size={15} />
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 36, height: 36, flexShrink: 0,
            borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--color-accent-subtle)', color: 'var(--cyan-500)',
          }}
        >
          <Cookie size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="font-display font-semibold text-slate-100" style={{ fontSize: 14, marginBottom: 4 }}>
            Nós usamos cookies
          </h2>
          <p className="text-slate-400" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>
            Utilizamos cookies para manter sua sessão segura e aprimorar sua experiência de uso.
            Ao continuar, você concorda com o armazenamento de cookies no seu dispositivo,
            conforme a&nbsp;LGPD (Lei&nbsp;13.709/2018).
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-primary" style={{ fontSize: 12.5 }} onClick={() => decide('accepted')}>
              Aceitar
            </button>
            <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={() => decide('rejected')}>
              Apenas essenciais
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
