// Campos ausentes em um modelo são ignorados no destino (não sobrescrevem com vazio).
export type SoapTemplate = { label: string; s?: string; o?: string; a?: string; p?: string };

export const NOTE_TEMPLATES: SoapTemplate[] = [
  {
    label: 'Consulta de rotina',
    s: 'Comparece para consulta de rotina. Assintomático(a). Nega queixas no momento.',
    o: 'Bom estado geral, corado(a), hidratado(a), afebril, acianótico(a), anictérico(a). ACV: RCR 2T, bulhas normofonéticas, sem sopros. AR: MV presente bilateralmente, sem ruídos adventícios. Abdome: flácido, indolor, RHA presentes. MMII sem edemas.',
    a: 'Paciente hígido(a), sem alterações ao exame.',
    p: 'Mantidas orientações gerais de hábitos de vida. Retorno se surgirem sintomas.',
  },
  {
    label: 'Retorno',
    s: 'Retorno para reavaliação. Refere melhora do quadro. Em uso da medicação prescrita.',
    o: 'Bom estado geral, estável hemodinamicamente.',
    a: 'Evolução clínica favorável.',
    p: 'Mantida conduta. Retorno conforme orientação ou se piora.',
  },
  {
    label: 'IVAS / resfriado',
    s: 'Refere coriza, obstrução nasal, odinofagia e tosse seca há poucos dias. Nega dispneia, dor torácica ou febre alta persistente.',
    o: 'BEG, afebril no momento. Orofaringe hiperemiada, sem placas. AR: MV+ sem ruídos adventícios. SatO2 em ar ambiente normal.',
    a: 'Infecção de vias aéreas superiores (IVAS), provável etiologia viral.',
    p: 'Sintomáticos. Hidratação abundante e repouso relativo. Orientado retorno se dispneia, febre persistente (>72h) ou piora.',
  },
  {
    label: 'Afastamento',
    s: 'Quadro clínico atual incompatível com as atividades laborais habituais.',
    a: 'Conforme hipótese diagnóstica e CID-10 registrados.',
    p: 'Emitido atestado de afastamento. Orientado repouso e retorno para reavaliação ao término do período.',
  },
  {
    label: 'Exame físico normal',
    o: 'BEG, LOTE, corado, hidratado, afebril. ACV: RCR 2T sem sopros. AR: MV+ sem RA. Abdome flácido, indolor, sem visceromegalias. MMII sem edema, panturrilhas livres.',
  },
];

export const appendText = (current: string, add?: string): string => {
  if (!add) return current;
  return current.trim() ? `${current.trimEnd()}\n${add}` : add;
};

export function SoapTemplateBar({ onPick }: { onPick: (t: SoapTemplate) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-500">Modelos:</span>
      {NOTE_TEMPLATES.map((t) => (
        <button
          key={t.label}
          type="button"
          className="text-xs px-2 py-0.5 rounded border border-navy-600 text-slate-300 hover:border-cyan-500/60 hover:text-cyan-300 transition"
          onClick={() => onPick(t)}
        >{t.label}</button>
      ))}
    </div>
  );
}
