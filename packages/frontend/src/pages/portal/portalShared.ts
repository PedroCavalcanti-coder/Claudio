/**
 * Constantes e helpers compartilhados entre PortalDoPaciente e seus subcomponentes.
 */

export const STEP_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  scheduled:      { label: 'Agendado',           color: '#3b82f6', icon: '📅' },
  arrived:        { label: 'Chegou',             color: '#8b5cf6', icon: '🏥' },
  in_progress:    { label: 'Em andamento',       color: '#f59e0b', icon: '🔬' },
  processing:     { label: 'Processando',        color: '#6366f1', icon: '⚙️' },
  in_report:      { label: 'Em laudo',           color: '#0891b2', icon: '📝' },
  second_opinion: { label: 'Revisão em curso',   color: '#7c3aed', icon: '👨‍⚕️' },
  completed:      { label: 'Finalizado',         color: '#10b981', icon: '✅' },
};

export interface ExamStep {
  key:        string;
  completed?: boolean;
  current?:   boolean;
}
