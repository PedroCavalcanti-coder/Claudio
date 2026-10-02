/**
 * StatusStepper — visualização horizontal do progresso do exame
 * (Agendado → Chegou → Em andamento → ... → Finalizado).
 */
import { STEP_CONFIG, type ExamStep } from '../portalShared';

interface Props {
  steps:    ExamStep[];
  current?: string;
  color:    string;
}

export default function StatusStepper({ steps, color }: Props) {
  return (
    <div className="flex items-start gap-1 overflow-x-auto pb-2">
      {steps.map((step, idx) => (
        <div key={step.key} className="flex items-center gap-1 shrink-0">
          <div className="flex flex-col items-center gap-1">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
              style={{
                background:  step.current ? color : step.completed ? 'rgba(16,185,129,0.2)' : 'rgba(17,34,64,0.8)',
                border:      `2px solid ${step.current ? color : step.completed ? '#10b981' : '#1e3050'}`,
                color:       step.current ? '#fff' : step.completed ? '#10b981' : '#4a6080',
              }}
            >
              {step.completed && !step.current ? '✓' : idx + 1}
            </div>
            <span
              className="text-[9px] font-mono text-center leading-tight max-w-[52px]"
              style={{ color: step.current ? color : step.completed ? '#10b981' : '#4a6080' }}
            >
              {STEP_CONFIG[step.key]?.label ?? step.key}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div className="w-5 h-0.5 mb-4 shrink-0"
              style={{ background: step.completed ? '#10b981' : '#1e3050' }} />
          )}
        </div>
      ))}
    </div>
  );
}
