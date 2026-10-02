import { useEffect, useId, useRef, useState } from 'react';
import { catalogApi } from '../api/endpoints';

/**
 * Input com autocomplete dos catálogos clínicos locais (#9): medicamentos ou
 * CID-10. Busca offline (debounce) e popula um <datalist>. Texto livre continua
 * permitido — a sugestão só ajuda a padronizar. `onPick` recebe o item escolhido
 * (quando o texto casa exatamente com uma sugestão), útil p/ preencher campos
 * derivados (ex.: princípio ativo).
 */
type Med = { id: string; name: string; active_ingredient?: string; form?: string; controlled?: boolean };
type Cid = { code: string; description: string; category?: string };

interface Props {
  kind: 'medications' | 'cid10';
  value: string;
  onChange: (v: string) => void;
  onPick?: (item: Med | Cid) => void;
  placeholder?: string;
  className?: string;
}

export function CatalogInput({ kind, value, onChange, onPick, placeholder, className }: Props) {
  const listId = useId();
  const [opts, setOpts] = useState<(Med | Cid)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setOpts([]); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = kind === 'medications' ? await catalogApi.medications(q) : await catalogApi.cid10(q);
        setOpts((r.data as any).data ?? []);
      } catch { setOpts([]); }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, kind]);

  const label = (o: Med | Cid) =>
    kind === 'medications'
      ? `${(o as Med).name}${(o as Med).form ? ' ' + (o as Med).form : ''}`
      : `${(o as Cid).code} — ${(o as Cid).description}`;

  return (
    <>
      <input
        className={className ?? 'input'}
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v);
          const hit = opts.find((o) => label(o) === v);
          if (hit && onPick) onPick(hit);
        }}
      />
      <datalist id={listId}>
        {opts.map((o, i) => <option key={i} value={label(o)} />)}
      </datalist>
    </>
  );
}
