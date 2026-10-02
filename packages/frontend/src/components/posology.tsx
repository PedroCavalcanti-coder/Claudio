// Posologia estruturada — vocabulário sugerido (via, frequência, duração).
// Inputs usam <datalist> (texto livre + sugestões padronizadas) para reduzir erro
// de via/frequência sem travar casos atípicos. Compartilhado entre a prescrição do
// prontuário (PatientChartF2) e a consulta do fluxo (AtendimentoConsultaPage).

export const ROUTE_OPTIONS = [
  'VO', 'SL', 'EV', 'IM', 'SC', 'ID', 'IT', 'Tópica', 'Inalatória',
  'Nasal', 'Oftálmica', 'Otológica', 'Retal', 'Vaginal', 'Transdérmica',
];
export const FREQ_OPTIONS = [
  '1x ao dia', '2x ao dia (12/12h)', '3x ao dia (8/8h)', '4x ao dia (6/6h)',
  'de 4/4h', 'de 6/6h', 'de 8/8h', 'de 12/12h', 'de 24/24h',
  '1x por semana', 'em jejum', 'após refeições', 'à noite',
  'se dor', 'se febre', 'ACM (a critério médico)', 'dose única',
];
export const DURATION_OPTIONS = [
  'dose única', '3 dias', '5 dias', '7 dias', '10 dias', '14 dias', '21 dias', '30 dias', 'uso contínuo',
];

// IDs dos datalists (referenciados via list="...").
export const POSOLOGY_LIST = { route: 'posology-route', freq: 'posology-freq', duration: 'posology-duration' };

export function PosologyDatalists() {
  return (
    <>
      <datalist id={POSOLOGY_LIST.route}>{ROUTE_OPTIONS.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id={POSOLOGY_LIST.freq}>{FREQ_OPTIONS.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id={POSOLOGY_LIST.duration}>{DURATION_OPTIONS.map((o) => <option key={o} value={o} />)}</datalist>
    </>
  );
}
