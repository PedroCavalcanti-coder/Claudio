import React, { useEffect, useRef } from 'react';
import { Loader2, AlertCircle, CheckCircle, X, ChevronLeft, ChevronRight } from 'lucide-react';

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-cyan-400" />;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonRows({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-navy-800/50">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

interface AlertProps { type?: 'error'|'success'|'info'; message: string; onClose?: () => void; }
export function Alert({ type = 'error', message, onClose }: AlertProps) {
  const styles = {
    error:   'bg-red-950/60 border-red-800/60 text-red-300',
    success: 'bg-emerald-950/60 border-emerald-800/60 text-emerald-300',
    info:    'bg-blue-950/60 border-blue-800/60 text-blue-300',
  };
  const Icon = type === 'success' ? CheckCircle : AlertCircle;
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm animate-fade-in ${styles[type]}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Fechar alerta"
          className="shrink-0 opacity-60 hover:opacity-100"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

interface ModalProps { open: boolean; onClose: () => void; title: string; children: React.ReactNode; size?: 'sm'|'md'|'lg'|'xl'; }
export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // a11y: fecha no Esc e move o foco para o diálogo ao abrir
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm:'max-w-sm', md:'max-w-lg', lg:'max-w-2xl', xl:'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-navy-950/80 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative card w-full ${widths[size]} animate-slide-up shadow-2xl flex flex-col max-h-[90vh] outline-none`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-navy-700 shrink-0">
          <h2 className="font-display font-semibold text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="text-slate-500 hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmProps { open: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void; loading?: boolean; danger?: boolean; }
export function ConfirmDialog({ open, title, message, onConfirm, onCancel, loading, danger }: ConfirmProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <p className="text-slate-400 text-sm mb-5">{message}</p>
      <div className="flex gap-3 justify-end">
        <button className="btn-ghost" onClick={onCancel}>Cancelar</button>
        <button
          className={danger ? 'btn-danger' : 'btn-primary'}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? <Spinner size={14} /> : 'Confirmar'}
        </button>
      </div>
    </Modal>
  );
}

interface PaginationProps { page: number; totalPages: number; onPageChange: (p: number) => void; }
export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-2">
      <button
        className="btn-ghost px-2 py-1.5"
        onClick={() => onPageChange(page - 1)}
        disabled={page === 1}
      ><ChevronLeft size={16} /></button>
      <span className="text-sm text-slate-400">
        {page} <span className="text-slate-600">de</span> {totalPages}
      </span>
      <button
        className="btn-ghost px-2 py-1.5"
        onClick={() => onPageChange(page + 1)}
        disabled={page === totalPages}
      ><ChevronRight size={16} /></button>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: React.ElementType; title: string; description?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
      <div className="w-14 h-14 rounded-2xl bg-navy-800 border border-navy-700 flex items-center justify-center">
        <Icon size={24} className="text-slate-500" />
      </div>
      <div>
        <p className="text-slate-300 font-medium">{title}</p>
        {description && <p className="text-slate-500 text-sm mt-1">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, error, children, required }: {
  label: string; error?: string; children: React.ReactNode; required?: boolean;
}) {
  return (
    <div>
      <label className="label">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

export function Select({ className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`input appearance-none ${className}`}
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat:'no-repeat', backgroundPosition:'right 0.75rem center' }}
      {...props}
    />
  );
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h2 className="font-display font-semibold text-xl text-slate-100">{title}</h2>
        {subtitle && <p className="text-slate-500 text-sm mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
export { default as ThemeToggle } from './ThemeToggle';