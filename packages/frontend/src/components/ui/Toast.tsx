/**
 * Sistema de Toast minimalista (sem dependências externas).
 *
 *   import { toast, Toaster } from '@/components/ui/Toast'
 *   toast.error('Falha ao salvar')
 *   toast.success('Laudo enviado')
 *   toast.info('Processando…')
 *   await toast.confirm('Sair sem salvar?')   // → boolean
 *
 * Uso: monte <Toaster /> uma única vez no root (App.tsx).
 */
import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

type ToastType  = 'error' | 'success' | 'info';
interface ToastItem {
  id:       number;
  type:     ToastType;
  message:  string;
  ttl:      number;
}
interface ConfirmItem {
  id:       number;
  title:    string;
  message:  string;
  resolve:  (ok: boolean) => void;
}

let nextId   = 1;
type Listener = (toasts: ToastItem[], confirms: ConfirmItem[]) => void;
const listeners = new Set<Listener>();
let toasts:   ToastItem[]   = [];
let confirms: ConfirmItem[] = [];

function notify() {
  for (const l of listeners) l(toasts, confirms);
}

function push(type: ToastType, message: string, ttl = 4000): void {
  const id = nextId++;
  toasts = [...toasts, { id, type, message, ttl }];
  notify();
  if (ttl > 0) setTimeout(() => dismiss(id), ttl);
}

function dismiss(id: number) {
  toasts = toasts.filter(t => t.id !== id);
  notify();
}

export const toast = {
  error:   (m: string, ttl?: number) => push('error',   m, ttl),
  success: (m: string, ttl?: number) => push('success', m, ttl),
  info:    (m: string, ttl?: number) => push('info',    m, ttl),
  confirm: (message: string, title = 'Confirmar') =>
    new Promise<boolean>(resolve => {
      const id = nextId++;
      confirms = [...confirms, { id, title, message, resolve }];
      notify();
    }),
};

function resolveConfirm(id: number, ok: boolean) {
  const c = confirms.find(x => x.id === id);
  confirms = confirms.filter(x => x.id !== id);
  notify();
  c?.resolve(ok);
}

const COLORS: Record<ToastType, { bg: string; bd: string; fg: string; Icon: React.ElementType }> = {
  error:   { bg: 'var(--color-danger-bg)',  bd: 'var(--color-danger)',  fg: 'var(--color-danger)',  Icon: AlertCircle },
  success: { bg: 'var(--color-success-bg)', bd: 'var(--color-success)', fg: 'var(--color-success)', Icon: CheckCircle },
  info:    { bg: 'var(--color-info-bg)',    bd: 'var(--color-info)',    fg: 'var(--color-info)',    Icon: Info        },
};

export function Toaster() {
  const [t,  setT]  = useState<ToastItem[]>(toasts);
  const [cf, setCf] = useState<ConfirmItem[]>(confirms);

  useEffect(() => {
    const l: Listener = (a, b) => { setT([...a]); setCf([...b]); };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  return (
    <>
      <div
        aria-live="polite"
        style={{
          position: 'fixed', top: 16, right: 16,
          zIndex: 100,
          display: 'flex', flexDirection: 'column', gap: 8,
          maxWidth: 380,
          pointerEvents: 'none',
        }}
      >
        {t.map(toast => {
          const { Icon, bg, bd, fg } = COLORS[toast.type];
          return (
            <div
              key={toast.id}
              role="status"
              style={{
                pointerEvents: 'auto',
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                background: bg,
                border: `1px solid ${bd}`,
                boxShadow: 'var(--shadow-md)',
                color: fg,
                fontSize: 13,
                animation: 'toast-in 0.2s ease',
              }}
            >
              <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ flex: 1 }}>{toast.message}</span>
              <button
                aria-label="Fechar notificação"
                onClick={() => dismiss(toast.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: fg, opacity: 0.6 }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        <style>{`@keyframes toast-in { from { opacity:0; transform: translateX(20px); } to { opacity:1; transform: translateX(0); } }`}</style>
      </div>

      {cf.map(c => (
        <div
          key={c.id}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`confirm-title-${c.id}`}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(4px)',
            padding: 16,
          }}
          onClick={() => resolveConfirm(c.id, false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: 380,
              width: '100%',
              background: 'var(--navy-900)',
              border: '1px solid var(--navy-700)',
              borderRadius: 12,
              padding: '20px 22px',
              boxShadow: 'var(--shadow-xl)',
            }}
          >
            <h2
              id={`confirm-title-${c.id}`}
              className="font-display font-semibold text-slate-100"
              style={{ fontSize: 16, marginBottom: 8 }}
            >
              {c.title}
            </h2>
            <p className="text-slate-400 text-sm" style={{ marginBottom: 18, lineHeight: 1.5 }}>
              {c.message}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-ghost"   onClick={() => resolveConfirm(c.id, false)}>Cancelar</button>
              <button className="btn-primary" onClick={() => resolveConfirm(c.id, true)} autoFocus>Confirmar</button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
