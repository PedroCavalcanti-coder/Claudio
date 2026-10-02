import { useQuery } from '@tanstack/react-query';
import { Building2, User, Cpu, DoorOpen, CalendarClock, Stethoscope, AlertTriangle, Activity } from 'lucide-react';
import { studiesApi } from '../../api/endpoints';
import { Modal, Spinner } from '../../components/ui';
import { formatDate, modalityLabel } from '../../utils/format';

const QUALITY_LABEL: Record<string, { label: string; cls: string }> = {
  adequate: { label: 'Adequado',                cls: 'badge-success' },
  limited:  { label: 'Limitado (com ressalvas)', cls: 'badge-warning' },
  repeat:   { label: 'Necessita repetição',      cls: 'badge-danger' },
};

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-navy-800 border border-navy-700 flex items-center justify-center shrink-0">
        <Icon size={14} className="text-cyan-400" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</p>
        <div className="text-sm text-slate-200 mt-0.5">{value ?? <span className="text-slate-600">—</span>}</div>
      </div>
    </div>
  );
}

/**
 * Detalhe do estudo — destaca o CONTEXTO DA REALIZAÇÃO capturado no upload:
 * onde, quem, quando, equipamento, qualidade e complicações.
 */
export default function StudyDetailModal({ studyId, onClose }: { studyId: string; onClose: () => void }) {
  const { data: s, isLoading } = useQuery({
    queryKey: ['study-detail', studyId],
    queryFn:  () => studiesApi.getById(studyId).then(r => (r.data as any).data),
  });

  const performedAt = s?.study_date
    ? `${formatDate(s.study_date)}${s.study_time ? ' às ' + String(s.study_time).slice(0,5) : ''}`
    : null;
  const quality = s?.exam_quality ? QUALITY_LABEL[s.exam_quality] : null;

  return (
    <Modal open onClose={onClose} title="Detalhes do exame" size="lg">
      {isLoading || !s ? (
        <div className="flex justify-center py-10"><Spinner size={22} /></div>
      ) : (
        <div className="space-y-5">
          {/* Cabeçalho */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-100 font-medium">{s.procedure_name ?? s.study_description ?? 'Exame'}</p>
              <p className="text-xs text-slate-500">
                {s.patient_name} · Pront. {s.medical_record_number}
              </p>
            </div>
            <span className="badge badge-info">{modalityLabel[s.modality_type] ?? s.modality_type}</span>
          </div>

          {/* Contexto da realização */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Realização do exame</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Row icon={CalendarClock} label="Data e hora da realização" value={performedAt} />
              <Row icon={Building2}     label="Unidade onde foi realizado" value={s.realized_unit_name} />
              <Row icon={User}          label="Técnico responsável"        value={s.technician_name} />
              <Row icon={Stethoscope}   label="Médico executor"            value={s.performing_physician} />
              <Row icon={Cpu}           label="Equipamento"                value={s.equipment_name} />
              <Row icon={DoorOpen}      label="Sala"                       value={s.room_name} />
              <Row icon={Activity}      label="Qualidade do exame"
                value={quality ? <span className={`badge ${quality.cls}`}>{quality.label}</span> : null} />
            </div>
          </div>

          {/* Complicações */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <AlertTriangle size={12} className="text-amber-400" /> Complicações / intercorrências
            </p>
            {s.operator_notes
              ? <p className="text-sm text-slate-300 bg-navy-900/50 border border-navy-700 rounded-lg p-3 whitespace-pre-wrap">{s.operator_notes}</p>
              : <p className="text-sm text-slate-600">Nenhuma intercorrência registrada.</p>}
          </div>

          {/* Técnico do estudo */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-navy-800/60 text-xs">
            <div>
              <span className="text-slate-500 uppercase tracking-wide">Imagens</span>
              <p className="text-slate-300 mt-0.5">{s.number_of_series} série(s) · {s.number_of_instances} imagem(ns)</p>
            </div>
            <div>
              <span className="text-slate-500 uppercase tracking-wide">Nº de acesso</span>
              <p className="text-slate-300 mt-0.5 font-mono">{s.accession_number ?? '—'}</p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
