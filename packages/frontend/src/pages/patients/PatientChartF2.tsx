import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Plus, Pill, FileText, Syringe, Paperclip, Download, FileSignature,
  ShieldAlert, Upload, Ban, Trash2, ListChecks, Baby, ClipboardPlus, X, FlaskConical, CheckCircle2,
} from 'lucide-react';
import { ehrApi } from '../../api/endpoints';
import { Spinner, Modal, Field, Select, EmptyState } from '../../components/ui';
import { toast } from '../../components/ui/Toast';
import { formatDate, formatDateTime, getErrorMessage } from '../../utils/format';
import { PosologyDatalists, POSOLOGY_LIST } from '../../components/posology';
import { CatalogInput } from '../../components/CatalogInput';
import { DrugSafetyBanner } from '../../components/DrugSafetyBanner';

const sel = (r: any) => (r.data as any).data as any[];
const openBlob = (res: any) => { const u = URL.createObjectURL(res.data); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); };

const SEV_LABEL: Record<string, string> = { severe: 'Grave', moderate: 'Moderada', mild: 'Leve', unknown: 'Indeterminada' };
export function AllergyBanner({ patientId }: { patientId: string }) {
  const { data } = useQuery({ queryKey: ['ehr-allergies', patientId], queryFn: () => ehrApi.allergies(patientId), select: sel });
  const active = (data ?? []).filter((a) => a.status === 'active');
  if (!active.length) return null;
  const severe = active.some((a) => a.severity === 'severe');
  return (
    <div className={`rounded-lg border px-4 py-2.5 flex items-center gap-3 ${severe
      ? 'bg-red-950/50 border-red-700/60' : 'bg-amber-950/40 border-amber-700/50'}`}>
      <AlertTriangle size={18} className={severe ? 'text-red-400' : 'text-amber-400'} />
      <div className="flex-1 min-w-0">
        <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 mr-2">Alergias</span>
        {active.map((a) => (
          <span key={a.id} className={`badge text-xs mr-1 ${a.severity === 'severe' ? 'badge-danger' : 'badge-warning'}`}>
            {a.allergen}{a.severity !== 'unknown' ? ` · ${SEV_LABEL[a.severity]}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// Gestação/lactação inferidas dos problemas ativos por CID-10 (cap. O / Z32-34 / Z3A / Z39.1) — não há schema dedicado
export function RiskBanner({ patientId }: { patientId: string }) {
  const { data } = useQuery({ queryKey: ['ehr-problems', patientId], queryFn: () => ehrApi.listProblems(patientId), select: sel });
  const active = (data ?? []).filter((p) => p.status === 'active');
  const isPreg = active.some((p) => (p.cid10_code && /^(O|Z3[234]|Z3A)/i.test(p.cid10_code)) || /gest|gr[áa]vid/i.test(p.title || ''));
  const isLact = active.some((p) => (p.cid10_code && /^Z39\.?1/i.test(p.cid10_code)) || /amament|lacta/i.test(p.title || ''));
  if (!isPreg && !isLact) return null;
  const tags = [isPreg ? 'Gestante' : null, isLact ? 'Lactante' : null].filter(Boolean) as string[];
  return (
    <div className="rounded-lg border px-4 py-2.5 flex items-center gap-3 bg-fuchsia-950/40 border-fuchsia-700/50">
      <Baby size={18} className="text-fuchsia-300" />
      <div className="flex-1 min-w-0">
        <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 mr-2">Contexto de risco</span>
        {tags.map((t) => <span key={t} className="badge badge-warning text-xs mr-1">{t}</span>)}
        <span className="text-xs text-slate-400 ml-1">— verifique categoria de risco do medicamento na gestação/lactação</span>
      </div>
    </div>
  );
}

export function ClinicalSummary({ patientId }: { patientId: string }) {
  const probs = useQuery({ queryKey: ['ehr-problems', patientId], queryFn: () => ehrApi.listProblems(patientId), select: sel });
  const meds = useQuery({ queryKey: ['ehr-medications', patientId], queryFn: () => ehrApi.medications(patientId), select: sel });
  const activeProbs = (probs.data ?? []).filter((p) => p.status === 'active');
  const activeMeds = (meds.data ?? []).filter((m) => m.status === 'active');
  if (!activeProbs.length && !activeMeds.length) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {activeProbs.length > 0 && (
        <div className="card p-3">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1.5 flex items-center gap-1"><ListChecks size={12} /> Problemas ativos</p>
          <div className="flex flex-wrap gap-1">{activeProbs.map((p) => <span key={p.id} className="badge badge-warning text-xs">{p.title}{p.cid10_code ? ` (${p.cid10_code})` : ''}</span>)}</div>
        </div>
      )}
      {activeMeds.length > 0 && (
        <div className="card p-3">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1.5 flex items-center gap-1"><Pill size={12} /> Medicamentos em uso</p>
          <div className="flex flex-wrap gap-1">{activeMeds.map((m) => <span key={m.id} className="badge badge-neutral text-xs">{m.name}{m.dose ? ` ${m.dose}` : ''}</span>)}</div>
        </div>
      )}
    </div>
  );
}

const ALLERGY_TYPES: Record<string, string> = { medication: 'Medicamento', food: 'Alimento', environmental: 'Ambiental', biological: 'Biológico', other: 'Outro' };
export function AllergiesTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['ehr-allergies', patientId], queryFn: () => ehrApi.allergies(patientId), select: sel });
  const inv = () => qc.invalidateQueries({ queryKey: ['ehr-allergies', patientId] });
  const statusMut = useMutation({
    mutationFn: ({ id, status }: any) => ehrApi.updateAllergy(id, { status }),
    onSuccess: () => { toast.success('Atualizado'); inv(); }, onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <TabShell icon={ShieldAlert} title="Alergias e reações adversas" onAdd={() => setOpen(true)} q={q}
      empty="Nenhuma alergia registrada."
      render={(rows) => rows.map((a) => (
        <Row key={a.id}>
          <div className="flex-1">
            <p className="text-sm text-slate-200">{a.allergen}
              <span className={`badge text-xs ml-2 ${a.severity === 'severe' ? 'badge-danger' : a.severity === 'moderate' ? 'badge-warning' : 'badge-neutral'}`}>{SEV_LABEL[a.severity]}</span>
              {a.status !== 'active' && <span className="badge badge-neutral text-xs ml-1">Inativa</span>}
            </p>
            <p className="text-xs text-slate-500">{ALLERGY_TYPES[a.allergen_type]}{a.reaction ? ` · ${a.reaction}` : ''}</p>
          </div>
          {a.status === 'active' && <button className="btn-ghost px-2 py-1 text-xs" disabled={statusMut.isPending}
            onClick={() => statusMut.mutate({ id: a.id, status: 'inactive' })}>Inativar</button>}
        </Row>
      ))}>
      <Modal open={open} onClose={() => setOpen(false)} title="Registrar alergia" size="md">
        <AllergyForm patientId={patientId} onDone={() => { setOpen(false); inv(); }} />
      </Modal>
    </TabShell>
  );
}
function AllergyForm({ patientId, onDone }: any) {
  const [f, setF] = useState({ allergen: '', allergen_type: 'medication', severity: 'unknown', reaction: '' });
  const mut = useMutation({
    mutationFn: () => ehrApi.createAllergy({ patient_id: patientId, ...f }),
    onSuccess: () => { toast.success('Alergia registrada'); onDone(); }, onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <Field label="Alérgeno / substância" required><input className="input" value={f.allergen} onChange={(e) => setF({ ...f, allergen: e.target.value })} placeholder="Ex.: Dipirona, Penicilina, Frutos do mar" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo"><Select value={f.allergen_type} onChange={(e) => setF({ ...f, allergen_type: e.target.value })}>{Object.entries(ALLERGY_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Gravidade"><Select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{Object.entries(SEV_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      </div>
      <Field label="Reação (opcional)"><input className="input" value={f.reaction} onChange={(e) => setF({ ...f, reaction: e.target.value })} placeholder="Ex.: urticária, anafilaxia" /></Field>
      <FormFooter pending={mut.isPending} disabled={!f.allergen.trim()} onClick={() => mut.mutate()} />
    </div>
  );
}

const MED_STATUS: Record<string, string> = { active: 'Em uso', suspended: 'Suspenso', completed: 'Concluído' };
const ADMIN_LABEL: Record<string, string> = { administered: 'Administrado', refused: 'Recusado', not_administered: 'Não administrado' };
const ADMIN_BADGE: Record<string, string> = { administered: 'badge-success', refused: 'badge-danger', not_administered: 'badge-warning' };
const REFUSAL_LABEL: Record<string, string> = {
  patient_refused: 'Paciente recusou', patient_absent: 'Paciente ausente', fasting: 'Jejum / NPO',
  clinical_change: 'Mudança clínica', not_available: 'Indisponível', intolerance: 'Intolerância / vômito',
  medical_order: 'Ordem médica', other: 'Outro',
};

// MAR (registro de administração de medicamentos) — somente leitura, dado já é criado pela enfermagem
function AdministrationsPanel({ patientId }: { patientId: string }) {
  const q = useQuery({ queryKey: ['ehr-administrations', patientId], queryFn: () => ehrApi.administrations(patientId), select: sel });
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <div className="space-y-2 pt-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5"><Syringe size={12} /> Administrações na unidade (MAR)</h3>
      {rows.map((a) => (
        <Row key={a.id}>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200">{a.drug_name}{a.dose ? ` · ${a.dose}` : ''}{a.route ? ` · ${a.route}` : ''}
              <span className={`badge text-xs ml-2 ${ADMIN_BADGE[a.status] ?? 'badge-neutral'}`}>{ADMIN_LABEL[a.status] ?? a.status}</span></p>
            <p className="text-xs text-slate-500">
              {a.administered_by_name ?? '—'} · {formatDateTime(a.administered_at)}
              {a.refusal_reason ? ` · motivo: ${REFUSAL_LABEL[a.refusal_reason] ?? a.refusal_reason}` : ''}
              {a.notes ? ` · ${a.notes}` : ''}
            </p>
          </div>
        </Row>
      ))}
    </div>
  );
}
// Compara pela 1ª palavra normalizada (princípio ativo) para tolerar variação de marca/dose entre os dois lados
const normDrug = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)[0] || '';

function ReconciliationPanel({ patientId }: { patientId: string }) {
  const medsQ = useQuery({ queryKey: ['ehr-medications', patientId], queryFn: () => ehrApi.medications(patientId), select: sel });
  const rxQ = useQuery({ queryKey: ['ehr-prescriptions', patientId], queryFn: () => ehrApi.prescriptions(patientId), select: sel });
  const inUse = (medsQ.data ?? []).filter((m) => m.status === 'active');
  const prescribed = (rxQ.data ?? [])
    .filter((rx) => rx.status !== 'cancelled')
    .flatMap((rx) => (rx.items ?? []).map((it: any) => ({ ...it, rx_status: rx.status })));
  if (!inUse.length && !prescribed.length) return null;
  const useKeys = new Set(inUse.map((m) => normDrug(m.name)).filter(Boolean));
  const rxKeys = new Set(prescribed.map((it) => normDrug(it.drug_name)).filter(Boolean));
  const dups = [...useKeys].filter((k) => rxKeys.has(k)).length;
  const dupCls = 'border-amber-500/50 bg-amber-500/10';
  return (
    <div className="space-y-2 pt-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
        <ListChecks size={12} /> Reconciliação medicamentosa
        {dups > 0 && <span className="badge badge-warning text-xs">{dups} possível duplicidade</span>}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] text-slate-500 mb-1">Em uso (domiciliar)</p>
          {inUse.length ? inUse.map((m) => {
            const dup = rxKeys.has(normDrug(m.name));
            return <div key={m.id} className={`rounded border px-2 py-1.5 mb-1 text-xs ${dup ? dupCls : 'border-navy-700'}`}>
              <span className="text-slate-200">{m.name}</span>{m.dose ? ` ${m.dose}` : ''}{dup && <span className="text-amber-400"> · também prescrito</span>}</div>;
          }) : <p className="text-xs text-slate-600">—</p>}
        </div>
        <div>
          <p className="text-[11px] text-slate-500 mb-1">Prescrito (nesta rede)</p>
          {prescribed.length ? prescribed.map((it, i) => {
            const dup = useKeys.has(normDrug(it.drug_name));
            return <div key={it.id ?? i} className={`rounded border px-2 py-1.5 mb-1 text-xs ${dup ? dupCls : 'border-navy-700'}`}>
              <span className="text-slate-200">{it.drug_name}</span>{it.dose ? ` ${it.dose}` : ''}
              {it.rx_status === 'draft' && <span className="text-slate-500"> · rascunho</span>}
              {dup && <span className="text-amber-400"> · já em uso</span>}</div>;
          }) : <p className="text-xs text-slate-600">—</p>}
        </div>
      </div>
    </div>
  );
}

export function MedicationsTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['ehr-medications', patientId], queryFn: () => ehrApi.medications(patientId), select: sel });
  const inv = () => qc.invalidateQueries({ queryKey: ['ehr-medications', patientId] });
  const statusMut = useMutation({ mutationFn: ({ id, status }: any) => ehrApi.updateMedication(id, { status }), onSuccess: () => { toast.success('Atualizado'); inv(); } });
  return (
    <TabShell icon={Pill} title="Medicamentos em uso" onAdd={() => setOpen(true)} q={q} empty="Nenhum medicamento registrado."
      render={(rows) => rows.map((m) => (
        <Row key={m.id}>
          <div className="flex-1">
            <p className="text-sm text-slate-200">{m.name}{m.dose ? ` ${m.dose}` : ''}
              <span className={`badge text-xs ml-2 ${m.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{MED_STATUS[m.status]}</span></p>
            <p className="text-xs text-slate-500">{[m.route, m.frequency, m.started_on ? `desde ${formatDate(m.started_on)}` : ''].filter(Boolean).join(' · ')}</p>
          </div>
          {m.status === 'active' && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => statusMut.mutate({ id: m.id, status: 'suspended' })}>Suspender</button>}
        </Row>
      ))}>
      <ReconciliationPanel patientId={patientId} />
      <AdministrationsPanel patientId={patientId} />
      <Modal open={open} onClose={() => setOpen(false)} title="Registrar medicamento" size="md">
        <MedicationForm patientId={patientId} onDone={() => { setOpen(false); inv(); }} />
      </Modal>
    </TabShell>
  );
}
function MedicationForm({ patientId, onDone }: any) {
  const [f, setF] = useState({ name: '', dose: '', route: '', frequency: '', started_on: '' });
  const mut = useMutation({ mutationFn: () => ehrApi.createMedication({ patient_id: patientId, ...f, started_on: f.started_on || undefined }), onSuccess: () => { toast.success('Registrado'); onDone(); }, onError: (e) => toast.error(getErrorMessage(e)) });
  return (
    <div className="space-y-3">
      <Field label="Medicamento" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Losartana" /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Dose"><input className="input" value={f.dose} onChange={(e) => setF({ ...f, dose: e.target.value })} placeholder="50mg" /></Field>
        <Field label="Via"><input className="input" value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })} placeholder="VO" /></Field>
        <Field label="Frequência"><input className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} placeholder="1x/dia" /></Field>
      </div>
      <Field label="Início (opcional)"><input className="input" type="date" value={f.started_on} onChange={(e) => setF({ ...f, started_on: e.target.value })} /></Field>
      <FormFooter pending={mut.isPending} disabled={!f.name.trim()} onClick={() => mut.mutate()} />
    </div>
  );
}

const HISTORY_TYPES: [string, string][] = [
  ['personal', 'Antecedentes pessoais'], ['familial', 'Antecedentes familiares'],
  ['surgical', 'Cirúrgicos'], ['habits', 'Hábitos de vida'],
  ['gyneco_obstetric', 'Gineco-obstétricos'], ['allergic', 'Antecedentes alérgicos'], ['other', 'Outros'],
];
export function HistoryTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ehr-history', patientId], queryFn: () => ehrApi.history(patientId), select: sel });
  const byType: Record<string, any> = {};
  (q.data ?? []).forEach((h) => { byType[h.history_type] = h; });
  if (q.isLoading) return <div className="p-8 text-center"><Spinner /></div>;
  return (
    <div className="space-y-3">
      {HISTORY_TYPES.map(([type, label]) => (
        <HistorySection key={type} patientId={patientId} type={type} label={label}
          current={byType[type]?.content ?? ''} updatedAt={byType[type]?.updated_at}
          onSaved={() => qc.invalidateQueries({ queryKey: ['ehr-history', patientId] })} />
      ))}
    </div>
  );
}
function HistorySection({ patientId, type, label, current, updatedAt, onSaved }: any) {
  const [val, setVal] = useState(current);
  const [editing, setEditing] = useState(false);
  const mut = useMutation({ mutationFn: () => ehrApi.saveHistory({ patient_id: patientId, history_type: type, content: val }), onSuccess: () => { toast.success('Salvo'); setEditing(false); onSaved(); }, onError: (e) => toast.error(getErrorMessage(e)) });
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-slate-200">{label}</h3>
        {!editing && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setVal(current); setEditing(true); }}>{current ? 'Editar' : 'Adicionar'}</button>}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea className="input resize-none" rows={3} value={val} onChange={(e) => setVal(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost text-xs" onClick={() => setEditing(false)}>Cancelar</button>
            <button className="btn-primary text-xs" disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? <Spinner size={12} /> : 'Salvar'}</button>
          </div>
        </div>
      ) : current ? <p className="text-sm text-slate-300 whitespace-pre-wrap">{current}</p>
        : <p className="text-xs text-slate-600">—</p>}
      {updatedAt && !editing && <p className="text-[10px] text-slate-600 mt-1">Atualizado {formatDateTime(updatedAt)}</p>}
    </div>
  );
}

const ATT_CAT: Record<string, string> = { exam_external: 'Exame externo', document: 'Documento', image: 'Imagem', referral: 'Encaminhamento', other: 'Outro' };
export function AttachmentsTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['ehr-attachments', patientId], queryFn: () => ehrApi.attachments(patientId), select: sel });
  const inv = () => qc.invalidateQueries({ queryKey: ['ehr-attachments', patientId] });
  const dl = async (id: string, filename: string) => {
    try { const res = await ehrApi.downloadAttachment(id); const u = URL.createObjectURL(res.data); const a = document.createElement('a'); a.href = u; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60000); }
    catch (e) { toast.error(getErrorMessage(e)); }
  };
  return (
    <TabShell icon={Paperclip} title="Anexos (exames externos, documentos)" onAdd={() => setOpen(true)} addLabel="Enviar" q={q} empty="Nenhum anexo."
      render={(rows) => rows.map((a) => (
        <Row key={a.id}>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200 truncate">{a.title || a.filename}</p>
            <p className="text-xs text-slate-500">{ATT_CAT[a.category]} · {a.filename} · {formatDate(a.created_at)}{a.uploaded_by_name ? ` · ${a.uploaded_by_name}` : ''}</p>
          </div>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => dl(a.id, a.filename)}><Download size={12} /> Baixar</button>
        </Row>
      ))}>
      <Modal open={open} onClose={() => setOpen(false)} title="Enviar anexo" size="md">
        <AttachmentForm patientId={patientId} onDone={() => { setOpen(false); inv(); }} />
      </Modal>
    </TabShell>
  );
}
function AttachmentForm({ patientId, onDone }: any) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('exam_external');
  const [title, setTitle] = useState('');
  const mut = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append('file', file!); fd.append('patient_id', patientId); fd.append('category', category); if (title) fd.append('title', title); return ehrApi.uploadAttachment(fd); },
    onSuccess: () => { toast.success('Anexo enviado'); onDone(); }, onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <Field label="Arquivo (PDF, imagem; até 25 MB)" required>
        <input type="file" className="input" accept=".pdf,image/*,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoria"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(ATT_CAT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Título (opcional)"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end pt-2 border-t border-navy-700">
        <button className="btn-primary" disabled={mut.isPending || !file} onClick={() => mut.mutate()}>{mut.isPending ? <Spinner size={14} /> : <><Upload size={14} /> Enviar</>}</button>
      </div>
    </div>
  );
}

const RX_TYPE: Record<string, string> = { common: 'Comum', controlled: 'Controle especial', antimicrobial: 'Antimicrobiano' };
export function PrescriptionsTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['ehr-prescriptions', patientId], queryFn: () => ehrApi.prescriptions(patientId), select: sel });
  const inv = () => qc.invalidateQueries({ queryKey: ['ehr-prescriptions', patientId] });
  const signMut = useMutation({ mutationFn: (id: string) => ehrApi.signPrescription(id), onSuccess: () => { toast.success('Prescrição assinada'); inv(); }, onError: (e) => toast.error(getErrorMessage(e)) });
  const cancelMut = useMutation({ mutationFn: (id: string) => ehrApi.cancelPrescription(id), onSuccess: () => { toast.success('Cancelada'); inv(); } });
  return (
    <TabShell icon={FileText} title="Prescrições" onAdd={() => setOpen(true)} q={q} empty="Nenhuma prescrição."
      render={(rows) => rows.map((rx) => (
        <div key={rx.id} className="card p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-200">{RX_TYPE[rx.rx_type]} <span className="text-slate-500 text-xs">· {rx.prescriber_name} · {formatDate(rx.created_at)}</span></span>
            <div className="flex items-center gap-1">
              {rx.control_number && <span className="badge badge-warning text-xs" title="Receituário de Controle Especial (Portaria 344)">Controle nº {rx.control_number}/{rx.control_year}</span>}
              <span className={`badge text-xs ${rx.status === 'signed' ? 'badge-success' : rx.status === 'cancelled' ? 'badge-danger' : 'badge-neutral'}`}>{rx.status === 'signed' ? 'Assinada' : rx.status === 'cancelled' ? 'Cancelada' : 'Rascunho'}</span>
              {rx.status === 'draft' && <>
                <button className="btn-primary px-2 py-1 text-xs" disabled={signMut.isPending} onClick={() => signMut.mutate(rx.id)}><FileSignature size={12} /> Assinar</button>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => cancelMut.mutate(rx.id)}><Ban size={12} /></button>
              </>}
              {rx.status === 'signed' && rx.pdf_available && <button className="btn-ghost px-2 py-1 text-xs" onClick={async () => { try { openBlob(await ehrApi.prescriptionPdf(rx.id)); } catch (e) { toast.error(getErrorMessage(e)); } }}><Download size={12} /> PDF</button>}
            </div>
          </div>
          <ul className="text-xs text-slate-400 space-y-0.5">
            {(rx.items ?? []).map((it: any) => <li key={it.id}>• <span className="text-slate-300">{it.drug_name}</span>{it.dose ? ` ${it.dose}` : ''} — {[it.route, it.frequency, it.duration].filter(Boolean).join(' · ')}</li>)}
          </ul>
        </div>
      ))}>
      <Modal open={open} onClose={() => setOpen(false)} title="Nova prescrição" size="lg">
        <PrescriptionForm patientId={patientId} onDone={() => { setOpen(false); inv(); }} />
      </Modal>
    </TabShell>
  );
}
function PrescriptionForm({ patientId, onDone }: any) {
  const [rxType, setRxType] = useState('common');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<any[]>([{ drug_name: '', dose: '', route: '', frequency: '', duration: '', quantity: '' }]);
  const [warnings, setWarnings] = useState<any[]>([]);
  const setItem = (i: number, k: string, v: string | boolean) => setItems(items.map((it, j) => j === i ? { ...it, [k]: v } : it));
  const mut = useMutation({
    mutationFn: () => ehrApi.createPrescription({ patient_id: patientId, rx_type: rxType, notes: notes || undefined, items: items.filter((i) => i.drug_name.trim()) }),
    onSuccess: (r: any) => { const w = r.data.data.allergy_warnings ?? []; if (w.length) { setWarnings(w); toast.error(`Alerta: ${w.length} medicamento(s) com alergia registrada`); } else { toast.success('Prescrição criada'); onDone(); } },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <div className="rounded-lg border border-red-700/60 bg-red-950/50 p-2 text-xs text-red-300">
          <AlertTriangle size={14} className="inline mr-1" /> Conflito com alergia: {warnings.map((w) => `${w.drug} (${w.allergen})`).join(', ')}. Revise antes de assinar — a prescrição foi salva como rascunho.
          <button className="btn-ghost text-xs ml-2" onClick={onDone}>Fechar</button>
        </div>
      )}
      <Field label="Tipo de receita"><Select value={rxType} onChange={(e) => setRxType(e.target.value)}>{Object.entries(RX_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <DrugSafetyBanner patientId={patientId} drugNames={items.map((i) => i.drug_name)} />
      <div className="space-y-2">
        <label className="label">Medicamentos</label>
        {items.map((it, i) => (
          <div key={i} className="rounded-lg border border-navy-800 p-2 space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <CatalogInput kind="medications" placeholder="Medicamento (busca no catálogo)" value={it.drug_name} onChange={(v) => setItem(i, 'drug_name', v)} />
              </div>
              <input className="input w-24" placeholder="Dose" value={it.dose} onChange={(e) => setItem(i, 'dose', e.target.value)} />
              {items.length > 1 && <button className="btn-ghost px-2" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
            </div>
            <div className="grid grid-cols-4 gap-2">
              <input className="input" list={POSOLOGY_LIST.route} placeholder="Via" value={it.route} onChange={(e) => setItem(i, 'route', e.target.value)} />
              <input className="input" list={POSOLOGY_LIST.freq} placeholder="Freq." value={it.frequency} onChange={(e) => setItem(i, 'frequency', e.target.value)} />
              <input className="input" list={POSOLOGY_LIST.duration} placeholder="Duração" value={it.duration} onChange={(e) => setItem(i, 'duration', e.target.value)} />
              <input className="input" placeholder="Qtd." value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={!!it.administer_at_unit} onChange={(e) => setItem(i, 'administer_at_unit', e.target.checked)} /> Administrar na unidade (fila da enfermagem)
            </label>
          </div>
        ))}
        <button className="btn-ghost text-xs" onClick={() => setItems([...items, { drug_name: '', dose: '', route: '', frequency: '', duration: '', quantity: '' }])}><Plus size={12} /> Item</button>
        <PosologyDatalists />
      </div>
      <Field label="Observações"><textarea className="input resize-none" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <FormFooter pending={mut.isPending} disabled={!items.some((i) => i.drug_name.trim())} onClick={() => mut.mutate()} label="Criar rascunho" />
    </div>
  );
}

const CERT_TYPE: Record<string, string> = { medical_leave: 'Atestado médico', attendance: 'Comparecimento', fitness: 'Aptidão', other: 'Declaração' };
export function CertificatesTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['ehr-certificates', patientId], queryFn: () => ehrApi.certificates(patientId), select: sel });
  const inv = () => qc.invalidateQueries({ queryKey: ['ehr-certificates', patientId] });
  const signMut = useMutation({ mutationFn: (id: string) => ehrApi.signCertificate(id), onSuccess: () => { toast.success('Atestado assinado'); inv(); }, onError: (e) => toast.error(getErrorMessage(e)) });
  return (
    <TabShell icon={FileSignature} title="Atestados e declarações" onAdd={() => setOpen(true)} q={q} empty="Nenhum atestado."
      render={(rows) => rows.map((c) => (
        <Row key={c.id}>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200">{CERT_TYPE[c.cert_type]}{c.days_off ? ` · ${c.days_off} dia(s)` : ''}
              <span className={`badge text-xs ml-2 ${c.status === 'signed' ? 'badge-success' : 'badge-neutral'}`}>{c.status === 'signed' ? 'Assinado' : 'Rascunho'}</span></p>
            <p className="text-xs text-slate-500 truncate">{c.content || '—'} · {formatDate(c.created_at)}</p>
          </div>
          {c.status === 'draft' && <button className="btn-primary px-2 py-1 text-xs" disabled={signMut.isPending} onClick={() => signMut.mutate(c.id)}><FileSignature size={12} /> Assinar</button>}
          {c.status === 'signed' && c.pdf_available && <button className="btn-ghost px-2 py-1 text-xs" onClick={async () => { try { openBlob(await ehrApi.certificatePdf(c.id)); } catch (e) { toast.error(getErrorMessage(e)); } }}><Download size={12} /> PDF</button>}
        </Row>
      ))}>
      <Modal open={open} onClose={() => setOpen(false)} title="Novo atestado/declaração" size="md">
        <CertificateForm patientId={patientId} onDone={() => { setOpen(false); inv(); }} />
      </Modal>
    </TabShell>
  );
}
function CertificateForm({ patientId, onDone }: any) {
  const [f, setF] = useState({ cert_type: 'medical_leave', content: '', days_off: '', cid10_code: '' });
  // CID-10 obrigatório em atestado de afastamento: exigência para validade e faturamento junto ao INSS
  const needsCid = f.cert_type === 'medical_leave' || Number(f.days_off) > 0;
  const mut = useMutation({
    mutationFn: () => ehrApi.createCertificate({ patient_id: patientId, cert_type: f.cert_type, content: f.content || undefined, days_off: f.days_off ? Number(f.days_off) : undefined, cid10_code: f.cid10_code || undefined }),
    onSuccess: () => { toast.success('Atestado criado'); onDone(); }, onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <Field label="Tipo"><Select value={f.cert_type} onChange={(e) => setF({ ...f, cert_type: e.target.value })}>{Object.entries(CERT_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Texto (opcional — gerado se vazio para atestado)"><textarea className="input resize-none" rows={3} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} placeholder="Atesto, para os devidos fins, que..." /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dias de afastamento"><input className="input" type="number" min={0} value={f.days_off} onChange={(e) => setF({ ...f, days_off: e.target.value })} /></Field>
        <Field label="CID-10" required={needsCid}><input className="input" value={f.cid10_code} onChange={(e) => setF({ ...f, cid10_code: e.target.value })} placeholder={needsCid ? 'Obrigatório — ex.: J11' : 'Ex.: J11'} /></Field>
      </div>
      {needsCid && <p className="text-[11px] text-amber-400/80">Atestado de afastamento exige CID-10 para validade e faturamento.</p>}
      <FormFooter pending={mut.isPending} disabled={needsCid && !f.cid10_code.trim()} onClick={() => mut.mutate()} label="Criar rascunho" />
    </div>
  );
}

const IMM_STATUS: Record<string, string> = { applied: 'Aplicada', scheduled: 'Agendada', delayed: 'Atrasada' };
export function ImmunizationsTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['ehr-immunizations', patientId], queryFn: () => ehrApi.immunizations(patientId), select: sel });
  const inv = () => qc.invalidateQueries({ queryKey: ['ehr-immunizations', patientId] });
  return (
    <TabShell icon={Syringe} title="Carteira de vacinação" onAdd={() => setOpen(true)} q={q} empty="Nenhuma vacina registrada."
      render={(rows) => rows.map((v) => (
        <Row key={v.id}>
          <div className="flex-1">
            <p className="text-sm text-slate-200">{v.vaccine}{v.dose_label ? ` · ${v.dose_label}` : ''}
              <span className={`badge text-xs ml-2 ${v.status === 'applied' ? 'badge-success' : v.status === 'delayed' ? 'badge-danger' : 'badge-info'}`}>{IMM_STATUS[v.status]}</span></p>
            <p className="text-xs text-slate-500">{[v.applied_at ? formatDate(v.applied_at) : (v.scheduled_for ? `agendada ${formatDate(v.scheduled_for)}` : ''), v.lot ? `lote ${v.lot}` : '', v.manufacturer, v.site].filter(Boolean).join(' · ')}</p>
          </div>
        </Row>
      ))}>
      <Modal open={open} onClose={() => setOpen(false)} title="Registrar vacina" size="md">
        <ImmunizationForm patientId={patientId} onDone={() => { setOpen(false); inv(); }} />
      </Modal>
    </TabShell>
  );
}
function ImmunizationForm({ patientId, onDone }: any) {
  const [f, setF] = useState({ vaccine: '', dose_label: '', lot: '', manufacturer: '', route: '', site: '', status: 'applied', applied_at: '', scheduled_for: '' });
  const mut = useMutation({
    mutationFn: () => ehrApi.createImmunization({ patient_id: patientId, vaccine: f.vaccine, dose_label: f.dose_label || undefined, lot: f.lot || undefined, manufacturer: f.manufacturer || undefined, route: f.route || undefined, site: f.site || undefined, status: f.status, applied_at: f.applied_at ? new Date(f.applied_at).toISOString() : undefined, scheduled_for: f.scheduled_for || undefined }),
    onSuccess: () => { toast.success('Vacina registrada'); onDone(); }, onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vacina" required><input className="input" value={f.vaccine} onChange={(e) => setF({ ...f, vaccine: e.target.value })} placeholder="Ex.: Influenza" /></Field>
        <Field label="Dose"><input className="input" value={f.dose_label} onChange={(e) => setF({ ...f, dose_label: e.target.value })} placeholder="1ª dose / reforço" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lote"><input className="input" value={f.lot} onChange={(e) => setF({ ...f, lot: e.target.value })} /></Field>
        <Field label="Fabricante"><input className="input" value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Via"><input className="input" value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })} placeholder="IM" /></Field>
        <Field label="Local"><input className="input" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} placeholder="Deltoide D" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Situação"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(IMM_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        {f.status === 'applied'
          ? <Field label="Aplicada em"><input className="input" type="datetime-local" value={f.applied_at} onChange={(e) => setF({ ...f, applied_at: e.target.value })} /></Field>
          : <Field label="Agendada para"><input className="input" type="date" value={f.scheduled_for} onChange={(e) => setF({ ...f, scheduled_for: e.target.value })} /></Field>}
      </div>
      <FormFooter pending={mut.isPending} disabled={!f.vaccine.trim()} onClick={() => mut.mutate()} />
    </div>
  );
}

type ScaleItemDef = { key: string; label: string; options: { label: string; points: number }[] };
type ScaleDef = { id: 'morse' | 'braden'; name: string; items: ScaleItemDef[]; risk: (score: number) => string };

const MORSE: ScaleDef = {
  id: 'morse', name: 'Morse — risco de queda',
  items: [
    { key: 'historico_quedas', label: 'Histórico de quedas (≤ 3 meses)', options: [{ label: 'Não', points: 0 }, { label: 'Sim', points: 25 }] },
    { key: 'diagnostico_secundario', label: 'Diagnóstico secundário (> 1)', options: [{ label: 'Não', points: 0 }, { label: 'Sim', points: 15 }] },
    { key: 'auxilio_deambulacao', label: 'Auxílio na deambulação', options: [{ label: 'Nenhum / repouso / cadeira de rodas', points: 0 }, { label: 'Muletas / bengala / andador', points: 15 }, { label: 'Apoia-se no mobiliário', points: 30 }] },
    { key: 'terapia_ev', label: 'Terapia EV / dispositivo salinizado', options: [{ label: 'Não', points: 0 }, { label: 'Sim', points: 20 }] },
    { key: 'marcha', label: 'Marcha', options: [{ label: 'Normal / acamado / imóvel', points: 0 }, { label: 'Fraca', points: 10 }, { label: 'Comprometida', points: 20 }] },
    { key: 'estado_mental', label: 'Estado mental', options: [{ label: 'Consciente das limitações', points: 0 }, { label: 'Superestima / esquece limitações', points: 15 }] },
  ],
  risk: (s) => (s >= 45 ? 'alto' : s >= 25 ? 'moderado' : 'baixo'),
};
const BRADEN: ScaleDef = {
  id: 'braden', name: 'Braden — risco de lesão por pressão',
  items: [
    { key: 'percepcao_sensorial', label: 'Percepção sensorial', options: [{ label: '1 — Totalmente limitada', points: 1 }, { label: '2 — Muito limitada', points: 2 }, { label: '3 — Levemente limitada', points: 3 }, { label: '4 — Nenhuma limitação', points: 4 }] },
    { key: 'umidade', label: 'Umidade da pele', options: [{ label: '1 — Constantemente úmida', points: 1 }, { label: '2 — Muito úmida', points: 2 }, { label: '3 — Ocasionalmente úmida', points: 3 }, { label: '4 — Raramente úmida', points: 4 }] },
    { key: 'atividade', label: 'Atividade', options: [{ label: '1 — Acamado', points: 1 }, { label: '2 — Confinado à cadeira', points: 2 }, { label: '3 — Anda ocasionalmente', points: 3 }, { label: '4 — Anda frequentemente', points: 4 }] },
    { key: 'mobilidade', label: 'Mobilidade', options: [{ label: '1 — Totalmente imóvel', points: 1 }, { label: '2 — Muito limitada', points: 2 }, { label: '3 — Levemente limitada', points: 3 }, { label: '4 — Não limitada', points: 4 }] },
    { key: 'nutricao', label: 'Nutrição', options: [{ label: '1 — Muito pobre', points: 1 }, { label: '2 — Provavelmente inadequada', points: 2 }, { label: '3 — Adequada', points: 3 }, { label: '4 — Excelente', points: 4 }] },
    { key: 'friccao_cisalhamento', label: 'Fricção e cisalhamento', options: [{ label: '1 — Problema', points: 1 }, { label: '2 — Problema potencial', points: 2 }, { label: '3 — Nenhum problema aparente', points: 3 }] },
  ],
  risk: (s) => (s <= 9 ? 'muito_alto' : s <= 12 ? 'alto' : s <= 14 ? 'moderado' : s <= 18 ? 'baixo' : 'sem_risco'),
};
const SCALES: Record<string, ScaleDef> = { morse: MORSE, braden: BRADEN };
const RISK_LABEL: Record<string, string> = { baixo: 'Baixo', moderado: 'Moderado', alto: 'Alto', muito_alto: 'Muito alto', sem_risco: 'Sem risco' };
const RISK_BADGE: Record<string, string> = { baixo: 'badge-success', moderado: 'badge-warning', alto: 'badge-danger', muito_alto: 'badge-danger', sem_risco: 'badge-neutral' };

export function NursingScalesTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['ehr-nursing', patientId], queryFn: () => ehrApi.nursingAssessments(patientId), select: sel });
  return (
    <TabShell icon={ListChecks} title="Escalas de enfermagem (Morse / Braden)" onAdd={() => setOpen(true)} addLabel="Avaliar" q={q} empty="Nenhuma avaliação registrada."
      render={(rows) => rows.map((a) => (
        <Row key={a.id}>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200">{SCALES[a.scale]?.name ?? a.scale} · <b>{a.score}</b>
              <span className={`badge text-xs ml-2 ${RISK_BADGE[a.risk_level] ?? 'badge-neutral'}`}>{RISK_LABEL[a.risk_level] ?? a.risk_level}</span></p>
            <p className="text-xs text-slate-500">{formatDateTime(a.created_at)}{a.assessed_by_name ? ` · ${a.assessed_by_name}` : ''}</p>
          </div>
        </Row>
      ))}>
      <Modal open={open} onClose={() => setOpen(false)} title="Nova avaliação de enfermagem" size="md">
        <NursingScaleForm patientId={patientId} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['ehr-nursing', patientId] }); }} />
      </Modal>
    </TabShell>
  );
}
function NursingScaleForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [scaleId, setScaleId] = useState<'morse' | 'braden'>('morse');
  const def = SCALES[scaleId];
  const [sel2, setSel2] = useState<Record<string, number>>({});
  const idxOf = (it: ScaleItemDef) => sel2[it.key] ?? 0;
  const score = def.items.reduce((sum, it) => sum + it.options[idxOf(it)].points, 0);
  const risk = def.risk(score);
  const switchScale = (id: 'morse' | 'braden') => { setScaleId(id); setSel2({}); };
  const mut = useMutation({
    mutationFn: () => ehrApi.createNursingAssessment({
      patient_id: patientId, scale: scaleId, score, risk_level: risk,
      items: Object.fromEntries(def.items.map((it) => [it.key, it.options[idxOf(it)].points])),
    }),
    onSuccess: () => { toast.success('Avaliação registrada'); onDone(); }, onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(['morse', 'braden'] as const).map((id) => (
          <button key={id} type="button" onClick={() => switchScale(id)}
            className={`flex-1 px-3 py-2 text-xs rounded border ${scaleId === id ? 'border-cyan-500 text-cyan-300 bg-cyan-500/10' : 'border-navy-700 text-slate-400'}`}>
            {SCALES[id].name}
          </button>
        ))}
      </div>
      {def.items.map((it) => (
        <Field key={it.key} label={it.label}>
          <Select value={String(idxOf(it))} onChange={(e) => setSel2((p) => ({ ...p, [it.key]: Number(e.target.value) }))}>
            {it.options.map((o, i) => <option key={i} value={i}>{o.label} ({o.points})</option>)}
          </Select>
        </Field>
      ))}
      <div className="flex items-center justify-between rounded-lg border border-navy-700 px-3 py-2">
        <span className="text-sm text-slate-300">Escore: <b className="text-slate-100">{score}</b></span>
        <span className={`badge ${RISK_BADGE[risk]}`}>Risco {RISK_LABEL[risk]}</span>
      </div>
      <FormFooter pending={mut.isPending} disabled={false} onClick={() => mut.mutate()} label="Registrar avaliação" />
    </div>
  );
}

// Sugestões de diagnósticos de enfermagem seguindo taxonomias NANDA/CIPE
const NURSING_DX = [
  'Risco de queda', 'Risco de lesão por pressão', 'Dor aguda', 'Dor crônica',
  'Mobilidade física prejudicada', 'Integridade da pele prejudicada', 'Risco de infecção',
  'Déficit no autocuidado', 'Ansiedade', 'Náusea', 'Hipertermia', 'Padrão respiratório ineficaz',
  'Volume de líquidos deficiente', 'Nutrição desequilibrada', 'Risco de aspiração',
];
export function NursingEvolutionTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['ehr-nursing-evo', patientId], queryFn: () => ehrApi.nursingEvolutions(patientId), select: sel });
  return (
    <TabShell icon={ClipboardPlus} title="Evolução de enfermagem (SAE)" onAdd={() => setOpen(true)} addLabel="Evoluir" q={q} empty="Nenhuma evolução de enfermagem registrada."
      render={(rows) => rows.map((e) => (
        <div key={e.id} className="card px-4 py-3 space-y-1.5">
          <p className="text-xs text-slate-500">{formatDateTime(e.created_at)}{e.author_name ? ` · ${e.author_name}` : ''}</p>
          {(e.diagnoses?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1">
              {e.diagnoses.map((d: string, i: number) => <span key={i} className="badge badge-warning text-xs">{d}</span>)}
            </div>
          )}
          {e.assessment && <p className="text-sm text-slate-300"><b className="text-slate-400">Avaliação:</b> {e.assessment}</p>}
          {e.interventions && <p className="text-sm text-slate-300"><b className="text-slate-400">Condutas:</b> {e.interventions}</p>}
          {e.evaluation && <p className="text-sm text-slate-300"><b className="text-slate-400">Evolução:</b> {e.evaluation}</p>}
        </div>
      ))}>
      <Modal open={open} onClose={() => setOpen(false)} title="Nova evolução de enfermagem (SAE)" size="md">
        <NursingEvolutionForm patientId={patientId} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['ehr-nursing-evo', patientId] }); }} />
      </Modal>
    </TabShell>
  );
}
function NursingEvolutionForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [f, setF] = useState({ assessment: '', interventions: '', evaluation: '' });
  const [diagnoses, setDiagnoses] = useState<string[]>([]);
  const [dxInput, setDxInput] = useState('');
  const addDx = () => { const v = dxInput.trim(); if (v && !diagnoses.includes(v)) setDiagnoses([...diagnoses, v]); setDxInput(''); };
  const mut = useMutation({
    mutationFn: () => ehrApi.createNursingEvolution({
      patient_id: patientId, diagnoses,
      assessment: f.assessment || undefined, interventions: f.interventions || undefined, evaluation: f.evaluation || undefined,
    }),
    onSuccess: () => { toast.success('Evolução de enfermagem registrada'); onDone(); }, onError: (e) => toast.error(getErrorMessage(e)),
  });
  const empty = !f.assessment && !f.interventions && !f.evaluation && diagnoses.length === 0;
  return (
    <div className="space-y-3">
      <Field label="Avaliação / dados (subjetivo + objetivo)">
        <textarea className="input resize-none" rows={2} value={f.assessment} onChange={(e) => setF({ ...f, assessment: e.target.value })} placeholder="Estado geral, queixas, exame físico…" />
      </Field>
      <div>
        <p className="text-sm text-slate-300 mb-1">Diagnósticos de enfermagem</p>
        <div className="flex gap-2">
          <input className="input flex-1" list="nursing-dx" value={dxInput} onChange={(e) => setDxInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDx(); } }} placeholder="Ex.: Risco de queda" />
          <datalist id="nursing-dx">{NURSING_DX.map((d) => <option key={d} value={d} />)}</datalist>
          <button type="button" className="btn-ghost" onClick={addDx}><Plus size={14} /></button>
        </div>
        {diagnoses.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {diagnoses.map((d) => (
              <span key={d} className="badge badge-warning text-xs flex items-center gap-1">{d}
                <button type="button" onClick={() => setDiagnoses(diagnoses.filter((x) => x !== d))}><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
      </div>
      <Field label="Condutas / prescrição de enfermagem">
        <textarea className="input resize-none" rows={2} value={f.interventions} onChange={(e) => setF({ ...f, interventions: e.target.value })} placeholder="Cuidados, intervenções planejadas…" />
      </Field>
      <Field label="Evolução (resposta ao cuidado)">
        <textarea className="input resize-none" rows={2} value={f.evaluation} onChange={(e) => setF({ ...f, evaluation: e.target.value })} placeholder="Evolução do paciente no período…" />
      </Field>
      <FormFooter pending={mut.isPending} disabled={empty} onClick={() => mut.mutate()} label="Registrar evolução" />
    </div>
  );
}

const SVC_TYPE: Record<string, string> = { lab: 'Laboratório', imaging: 'Imagem', other: 'Outros' };
const SVC_STATUS: Record<string, { label: string; cls: string }> = {
  requested: { label: 'Solicitado', cls: 'badge-warning' },
  in_progress: { label: 'Em andamento', cls: 'badge-neutral' },
  completed: { label: 'Concluído', cls: 'badge-success' },
  cancelled: { label: 'Cancelado', cls: 'badge-danger' },
};
const COMMON_EXAMS = [
  'Hemograma completo', 'Glicemia de jejum', 'Ureia', 'Creatinina', 'TGO/AST', 'TGP/ALT',
  'Colesterol total e frações', 'Triglicerídeos', 'TSH', 'T4 livre', 'EAS / Urina tipo I',
  'Sumário de urina', 'PCR', 'Sódio', 'Potássio', 'Beta-HCG', 'Coagulograma',
  'Raio-X de tórax', 'Ultrassonografia de abdome', 'Eletrocardiograma',
];
export function ServiceRequestsTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['ehr-sadt', patientId], queryFn: () => ehrApi.serviceRequests(patientId), select: sel });
  const inv = () => qc.invalidateQueries({ queryKey: ['ehr-sadt', patientId] });
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => ehrApi.setServiceRequestStatus(id, status),
    onSuccess: () => { toast.success('Status atualizado'); inv(); }, onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <TabShell icon={FlaskConical} title="Solicitação de exames (SADT)" onAdd={() => setOpen(true)} addLabel="Solicitar" q={q} empty="Nenhuma solicitação de exames."
      render={(rows) => rows.map((r) => (
        <div key={r.id} className="card px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-200">
              {SVC_TYPE[r.request_type] ?? r.request_type}
              {r.priority === 'urgent' && <span className="badge badge-danger text-xs ml-2"><AlertTriangle size={9} /> Urgente</span>}
              <span className={`badge text-xs ml-2 ${SVC_STATUS[r.status]?.cls ?? 'badge-neutral'}`}>{SVC_STATUS[r.status]?.label ?? r.status}</span>
            </p>
            {(r.status === 'requested' || r.status === 'in_progress') && (
              <div className="flex gap-1 shrink-0">
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => statusMut.mutate({ id: r.id, status: 'completed' })}><CheckCircle2 size={11} /> Concluir</button>
                <button className="btn-ghost px-2 py-1 text-xs text-red-400" onClick={() => statusMut.mutate({ id: r.id, status: 'cancelled' })}><Ban size={11} /> Cancelar</button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {r.items?.map((it: any) => <span key={it.id} className="badge badge-neutral text-xs">{it.exam_name}{it.code ? ` (${it.code})` : ''}</span>)}
          </div>
          {r.clinical_indication && <p className="text-xs text-slate-500">Indicação: {r.clinical_indication}</p>}
          <p className="text-xs text-slate-600">{formatDateTime(r.created_at)}{r.requested_by_name ? ` · ${r.requested_by_name}` : ''}</p>
        </div>
      ))}>
      <Modal open={open} onClose={() => setOpen(false)} title="Solicitar exames (SADT)" size="md">
        <ServiceRequestForm patientId={patientId} onDone={() => { setOpen(false); inv(); }} />
      </Modal>
    </TabShell>
  );
}
function ServiceRequestForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [head, setHead] = useState({ request_type: 'lab', priority: 'routine', clinical_indication: '' });
  const [items, setItems] = useState<{ exam_name: string; code: string; notes: string }[]>([{ exam_name: '', code: '', notes: '' }]);
  const setItem = (i: number, k: string, v: string) => setItems((p) => p.map((it, idx) => idx === i ? { ...it, [k]: v } : it));
  const addItem = () => setItems((p) => [...p, { exam_name: '', code: '', notes: '' }]);
  const rmItem = (i: number) => setItems((p) => p.filter((_, idx) => idx !== i));
  const valid = items.some((it) => it.exam_name.trim());
  const mut = useMutation({
    mutationFn: () => ehrApi.createServiceRequest({
      patient_id: patientId, request_type: head.request_type, priority: head.priority,
      clinical_indication: head.clinical_indication || undefined,
      items: items.filter((it) => it.exam_name.trim()).map((it) => ({ exam_name: it.exam_name.trim(), code: it.code || undefined, notes: it.notes || undefined })),
    }),
    onSuccess: () => { toast.success('Solicitação registrada'); onDone(); }, onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select value={head.request_type} onChange={(e) => setHead({ ...head, request_type: e.target.value })}>
            <option value="lab">Laboratório</option><option value="imaging">Imagem</option><option value="other">Outros</option>
          </Select>
        </Field>
        <Field label="Prioridade">
          <Select value={head.priority} onChange={(e) => setHead({ ...head, priority: e.target.value })}>
            <option value="routine">Rotina</option><option value="urgent">Urgente</option>
          </Select>
        </Field>
      </div>
      <datalist id="common-exams">{COMMON_EXAMS.map((e) => <option key={e} value={e} />)}</datalist>
      <div className="space-y-2">
        <p className="text-sm text-slate-300">Exames solicitados</p>
        {items.map((it, i) => (
          <div key={i} className="flex gap-2 items-start">
            <input className="input flex-1" list="common-exams" placeholder="Nome do exame" value={it.exam_name} onChange={(e) => setItem(i, 'exam_name', e.target.value)} />
            <input className="input w-24" placeholder="Cód." value={it.code} onChange={(e) => setItem(i, 'code', e.target.value)} />
            {items.length > 1 && <button type="button" className="btn-ghost px-2 h-[42px]" onClick={() => rmItem(i)}><X size={14} /></button>}
          </div>
        ))}
        <button type="button" className="btn-ghost text-xs" onClick={addItem}><Plus size={13} /> Adicionar exame</button>
      </div>
      <Field label="Indicação clínica">
        <textarea className="input resize-none" rows={2} value={head.clinical_indication} onChange={(e) => setHead({ ...head, clinical_indication: e.target.value })} placeholder="Motivo / hipótese diagnóstica" />
      </Field>
      <FormFooter pending={mut.isPending} disabled={!valid} onClick={() => mut.mutate()} label="Registrar solicitação" />
    </div>
  );
}

const AE_TYPE: Record<string, string> = {
  adverse_drug_reaction: 'Reação adversa a medicamento', allergy: 'Alergia', medication_error: 'Erro de medicação', other: 'Outro',
};
const AE_SEV: Record<string, { label: string; cls: string }> = {
  mild: { label: 'Leve', cls: 'badge-neutral' }, moderate: { label: 'Moderada', cls: 'badge-warning' },
  severe: { label: 'Grave', cls: 'badge-danger' }, life_threatening: { label: 'Ameaça à vida', cls: 'badge-danger' },
};
const AE_OUTCOME: Record<string, string> = {
  recovered: 'Recuperado', recovering: 'Em recuperação', sequelae: 'Com sequelas', death: 'Óbito', unknown: 'Desconhecido',
};
export function AdverseEventsTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['ehr-adverse', patientId], queryFn: () => ehrApi.adverseEvents(patientId), select: sel });
  return (
    <TabShell icon={ShieldAlert} title="Farmacovigilância (eventos adversos)" onAdd={() => setOpen(true)} addLabel="Notificar" q={q} empty="Nenhum evento adverso notificado."
      render={(rows) => rows.map((e) => (
        <div key={e.id} className="card px-4 py-3 space-y-1">
          <p className="text-sm text-slate-200">
            {AE_TYPE[e.event_type] ?? e.event_type}
            <span className={`badge text-xs ml-2 ${AE_SEV[e.severity]?.cls ?? 'badge-neutral'}`}>{AE_SEV[e.severity]?.label ?? e.severity}</span>
            {e.suspected_drug && <span className="text-slate-400 text-xs ml-2">· {e.suspected_drug}</span>}
          </p>
          {e.description && <p className="text-sm text-slate-400">{e.description}</p>}
          <p className="text-xs text-slate-600">Desfecho: {AE_OUTCOME[e.outcome] ?? e.outcome} · {formatDateTime(e.created_at)}{e.reported_by_name ? ` · ${e.reported_by_name}` : ''}</p>
        </div>
      ))}>
      <Modal open={open} onClose={() => setOpen(false)} title="Notificar evento adverso" size="md">
        <AdverseEventForm patientId={patientId} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['ehr-adverse', patientId] }); }} />
      </Modal>
    </TabShell>
  );
}
function AdverseEventForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [f, setF] = useState({ event_type: 'adverse_drug_reaction', suspected_drug: '', description: '', severity: 'moderate', outcome: 'unknown' });
  const mut = useMutation({
    mutationFn: () => ehrApi.createAdverseEvent({
      patient_id: patientId, event_type: f.event_type, suspected_drug: f.suspected_drug || undefined,
      description: f.description || undefined, severity: f.severity, outcome: f.outcome,
    }),
    onSuccess: () => { toast.success('Evento adverso notificado'); onDone(); }, onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select value={f.event_type} onChange={(e) => setF({ ...f, event_type: e.target.value })}>
            {Object.entries(AE_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Gravidade">
          <Select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
            {Object.entries(AE_SEV).map(([v, l]) => <option key={v} value={v}>{l.label}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Medicamento suspeito (opcional)">
        <CatalogInput kind="medications" value={f.suspected_drug} onChange={(v) => setF({ ...f, suspected_drug: v })} placeholder="Busca no catálogo" />
      </Field>
      <Field label="Descrição do evento">
        <textarea className="input resize-none" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Relato da reação / evento" />
      </Field>
      <Field label="Desfecho">
        <Select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
          {Object.entries(AE_OUTCOME).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <FormFooter pending={mut.isPending} disabled={!f.description.trim() && !f.suspected_drug.trim()} onClick={() => mut.mutate()} label="Notificar" />
    </div>
  );
}

function TabShell({ icon: Icon, title, onAdd, addLabel = 'Adicionar', q, empty, render, children }: {
  icon: any; title: string; onAdd: () => void; addLabel?: string; q: any; empty: string;
  render: (rows: any[]) => React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2"><Icon size={15} /> {title}</h2>
        <button className="btn-primary" onClick={onAdd}><Plus size={16} /> {addLabel}</button>
      </div>
      {q.isLoading ? <div className="p-8 text-center"><Spinner /></div>
        : !(q.data?.length) ? <EmptyState icon={Icon} title={empty} />
          : <div className="space-y-2">{render(q.data)}</div>}
      {children}
    </div>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="card flex items-center gap-3 px-4 py-3">{children}</div>;
}
function FormFooter({ pending, disabled, onClick, label = 'Salvar' }: any) {
  return (
    <div className="flex justify-end pt-2 border-t border-navy-700">
      <button className="btn-primary" disabled={pending || disabled} onClick={onClick}>{pending ? <Spinner size={14} /> : label}</button>
    </div>
  );
}
