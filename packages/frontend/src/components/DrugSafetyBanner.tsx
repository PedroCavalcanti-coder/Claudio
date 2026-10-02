import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { ehrApi } from '../api/endpoints';

/**
 * Banner de segurança medicamentosa (#1 Nível 4): checa ao vivo, conforme o
 * médico digita, alergia (por nome E princípio ativo) + interação entre os itens.
 * Não bloqueia — alerta. Debounce p/ não consultar a cada tecla.
 */
type Allergy = { drug: string; allergen: string; matched_by?: string; ingredient?: string | null };
type Interaction = { drug_a: string; drug_b: string; severity: string; note?: string };

const SEV: Record<string, { label: string; cls: string }> = {
  severe:   { label: 'Grave',    cls: 'border-red-700/60 bg-red-950/50 text-red-300' },
  moderate: { label: 'Moderada', cls: 'border-amber-700/60 bg-amber-950/40 text-amber-300' },
  mild:     { label: 'Leve',     cls: 'border-yellow-700/50 bg-yellow-950/30 text-yellow-300' },
};

export function DrugSafetyBanner({ patientId, drugNames }: { patientId?: string; drugNames: string[] }) {
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const names = drugNames.map((d) => (d || '').trim()).filter(Boolean);
  const key = names.join('|');

  useEffect(() => {
    if (names.length === 0) { setAllergies([]); setInteractions([]); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await ehrApi.drugCheck(patientId, names);
        const d = (r.data as any).data ?? {};
        setAllergies(d.allergy_warnings ?? []);
        setInteractions(d.interaction_warnings ?? []);
      } catch { /* silencioso — é apenas um auxílio */ }
    }, 500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [key, patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allergies.length && !interactions.length) return null;

  return (
    <div className="space-y-1.5">
      {allergies.map((a, i) => (
        <div key={`al-${i}`} className="rounded-lg border border-red-700/60 bg-red-950/50 p-2 text-xs text-red-300 flex items-start gap-2">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <span><strong>Alergia:</strong> {a.drug} conflita com alergia a “{a.allergen}”
            {a.matched_by === 'active_ingredient' && a.ingredient ? <> (princípio ativo: {a.ingredient})</> : null}.</span>
        </div>
      ))}
      {interactions.map((it, i) => {
        const s = SEV[it.severity] ?? SEV.moderate;
        return (
          <div key={`in-${i}`} className={`rounded-lg border p-2 text-xs flex items-start gap-2 ${s.cls}`}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span><strong>Interação {s.label}:</strong> {it.drug_a} × {it.drug_b}{it.note ? ` — ${it.note}` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}
