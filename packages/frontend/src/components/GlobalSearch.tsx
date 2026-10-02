// Montado uma vez no AppLayout; também pode ser aberto disparando o evento 'open-global-search'.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { patientsApi } from '../api/endpoints';
import { useAuthStore } from '../stores/authStore';
import { formatDate } from '../utils/format';

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const canEhr = useAuthStore((s) => s.can('ehr'));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-global-search', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-global-search', onOpen); };
  }, []);

  useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 250); return () => clearTimeout(t); }, [term]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else { setTerm(''); setDebounced(''); setActive(0); }
  }, [open]);

  const q = useQuery({
    queryKey: ['global-patient-search', debounced], enabled: open && debounced.length >= 2,
    queryFn: () => patientsApi.list({ q: debounced, limit: 8 }).then((r) => (r.data as any).data as any[]),
  });
  const results = q.data ?? [];
  const go = (p: any) => { setOpen(false); navigate(canEhr ? `/patients/${p.id}/chart` : '/patients'); };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] bg-black/50" onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg mx-4 card p-0 overflow-hidden" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Busca global de paciente">
        <div className="flex items-center gap-2 px-3 border-b border-navy-700">
          <Search size={16} className="text-slate-500" />
          <input
            ref={inputRef} className="flex-1 bg-transparent py-3 text-sm outline-none text-slate-100"
            placeholder="Buscar paciente por nome ou CPF…" value={term}
            onChange={(e) => { setTerm(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter' && results[active]) go(results[active]);
            }}
          />
          <kbd className="text-[10px] text-slate-500 border border-navy-600 rounded px-1 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {debounced.length < 2 ? <p className="p-4 text-xs text-slate-500">Digite ao menos 2 caracteres.</p>
            : q.isLoading ? <p className="p-4 text-xs text-slate-500">Buscando…</p>
              : !results.length ? <p className="p-4 text-xs text-slate-500">Nenhum paciente encontrado.</p>
                : results.map((p, i) => (
                  <button
                    key={p.id} onClick={() => go(p)} onMouseEnter={() => setActive(i)}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between ${i === active ? 'bg-navy-800' : ''}`}
                  >
                    <span className="text-sm text-slate-200">{p.name}</span>
                    <span className="text-xs text-slate-500">{p.medical_record_number ?? ''}{p.birth_date ? ` · ${formatDate(p.birth_date)}` : ''}</span>
                  </button>
                ))}
        </div>
      </div>
    </div>
  );
}
