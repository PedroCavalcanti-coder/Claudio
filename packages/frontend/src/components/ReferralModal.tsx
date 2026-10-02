import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { healthUnitsApi, usersApi, referralsApi } from '../api/endpoints';
import { Modal, Spinner, Field } from './ui';
import { toast } from './ui/Toast';
import { useAuthStore } from '../stores/authStore';

interface Props {
  patientId:   string;
  patientName: string;
  onClose:     () => void;
}

export default function ReferralModal({ patientId, patientName, onClose }: Props) {
  const me = useAuthStore(s => s.user) as any;
  const isAdmin = !me?.health_unit_id; // sem lotação fixa → precisa escolher a unidade de origem manualmente
  const [fromUnitId, setFromUnitId] = useState<string>(me?.health_unit_id ?? '');
  const [toUnitId, setToUnitId]     = useState('');
  const [toUserId, setToUserId]     = useState('');
  const [specialty, setSpecialty]   = useState('');
  const [reason,    setReason]      = useState('');

  const { data: allUnits = [] } = useQuery({
    queryKey: ['referral-units'],
    queryFn:  () => healthUnitsApi.list(),
    select:   r => ((r.data as any).data as any[]).filter(u => u.is_active),
  });

  const originId  = me?.health_unit_id || fromUnitId;
  const destUnits = allUnits.filter((u: any) => u.id !== originId);

  const { data: targetUsers = [] } = useQuery({
    queryKey: ['referral-target-users', toUnitId],
    queryFn:  () => usersApi.list({ health_unit_id: toUnitId, limit: 100, page: 1 }),
    enabled:  !!toUnitId,
    select:   r => ((r.data as any).data as any[]).filter(u => u.is_active && (u.role === 'doctor' || u.role === 'radiologist')),
  });

  const submitMut = useMutation({
    mutationFn: () => referralsApi.create({
      patient_id:   patientId,
      from_unit_id: isAdmin ? fromUnitId : undefined,
      to_unit_id:   toUnitId,
      to_user_id:   toUserId || undefined,
      specialty:    specialty || undefined,
      reason:       reason.trim(),
    }),
    onSuccess: () => { toast.success('Encaminhamento criado com sucesso'); onClose(); },
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Falha ao encaminhar'),
  });

  const canSubmit = (!isAdmin || !!fromUnitId)
    && !!toUnitId && toUnitId !== originId
    && reason.trim().length >= 3;

  return (
    <Modal open onClose={onClose} title="Encaminhar paciente" size="md">
      <div className="space-y-4">
        <div className="rounded-lg border border-cyan-700/40 bg-cyan-900/10 px-3 py-2 text-sm">
          <strong className="text-slate-100">{patientName}</strong>
          <span className="text-slate-400"> · referência para outra unidade da rede</span>
        </div>

        {isAdmin && (
          <Field label="Unidade de origem" required>
            <select className="input" value={fromUnitId}
              onChange={e => { setFromUnitId(e.target.value); if (e.target.value === toUnitId) setToUnitId(''); }}>
              <option value="">— Selecione a origem —</option>
              {allUnits.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        )}

        <Field label="Unidade destino" required>
          <select className="input" value={toUnitId}
            disabled={isAdmin && !fromUnitId}
            onChange={e => { setToUnitId(e.target.value); setToUserId(''); }}>
            <option value="">— Selecione a unidade —</option>
            {destUnits.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {isAdmin && !fromUnitId && (
            <p className="text-xs text-slate-500 mt-1">Selecione a unidade de origem primeiro.</p>
          )}
        </Field>

        {/* to_user_id vazio deixa o referral disponível para qualquer médico da unidade destino aceitar */}
        <Field label="Médico específico (opcional)">
          <select className="input" value={toUserId} disabled={!toUnitId}
            onChange={e => setToUserId(e.target.value)}>
            <option value="">— Qualquer médico da unidade destino —</option>
            {targetUsers.map((u: any) => (
              <option key={u.id} value={u.id}>
                {u.name}{u.crm ? ` · CRM ${u.crm}${u.crm_uf ? '/' + u.crm_uf : ''}` : ''}{u.specialty ? ` · ${u.specialty}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Especialidade (opcional)">
          <input className="input" value={specialty} onChange={e => setSpecialty(e.target.value)}
            placeholder="Ex: Radiologia, Ortopedia..." />
        </Field>

        <Field label="Motivo do encaminhamento" required>
          <textarea className="input resize-none" rows={3} value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Justificativa clínica para o encaminhamento (mínimo 3 caracteres)..." />
        </Field>

        <div className="flex gap-3 justify-end pt-2 border-t border-navy-700">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!canSubmit || submitMut.isPending}
            onClick={() => submitMut.mutate()}>
            {submitMut.isPending ? <Spinner size={14} /> : <><Send size={13} /> Encaminhar</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
