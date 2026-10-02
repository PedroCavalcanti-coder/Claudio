import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Stethoscope, ArrowLeft, Plus, ShieldAlert, Activity, ListChecks, ClipboardList,
  FileSignature, Lock, Edit3, ChevronRight, HeartPulse, CalendarClock, FileText, Image,
  Pill, Syringe, Paperclip, BookOpen, ClipboardPlus, FlaskConical,
} from 'lucide-react';
import { ehrApi, patientsApi, catalogApi, type SoapInput, type VitalsInput } from '../../api/endpoints';
import { Spinner, Modal, Field, Select, EmptyState } from '../../components/ui';
import { toast } from '../../components/ui/Toast';
import { MarkdownTextarea } from '../../components/MarkdownTextarea';
import { SoapTemplateBar, appendText, type SoapTemplate } from '../../components/SoapTemplates';
import { formatDate, formatDateTime, formatAge, genderLabel, getErrorMessage } from '../../utils/format';
import {
  AllergyBanner, RiskBanner, ClinicalSummary, AllergiesTab, MedicationsTab, HistoryTab, AttachmentsTab,
  PrescriptionsTab, CertificatesTab, ImmunizationsTab, NursingScalesTab, NursingEvolutionTab,
  ServiceRequestsTab, AdverseEventsTab,
} from './PatientChartF2';

const isNoBond = (err: unknown) => {
  const e = err as any;
  return e?.response?.status === 403 && e?.response?.data?.code === 'NO_CLINICAL_BOND';
};
const ENCOUNTER_TYPES: Record<string, string> = {
  ambulatorial: 'Ambulatorial', urgencia: 'Urgência', retorno: 'Retorno', teleconsulta: 'Teleconsulta',
};
const NOTE_BADGE: Record<string, string> = {
  draft: 'badge-neutral', signed: 'badge-success', amended: 'badge-info',
};
const NOTE_LABEL: Record<string, string> = {
  draft: 'Rascunho', signed: 'Assinado', amended: 'Emendado',
};

export default function PatientChartPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<
    'timeline' | 'encounters' | 'problems' | 'allergies' | 'medications' |
    'prescriptions' | 'certificates' | 'immunizations' | 'attachments' | 'history' | 'vitals' | 'scales' | 'nursing' | 'sadt' | 'adverse'
  >('timeline');

  const patientQ = useQuery({
    queryKey: ['patient', id], enabled: !!id,
    queryFn: () => patientsApi.getById(id!), select: (r) => (r.data as any).data,
  });
  const patient = patientQ.data;

  // Usa a timeline como sonda de vínculo: 403 NO_CLINICAL_BOND aciona o break-glass e bloqueia as demais abas
  const timelineQ = useQuery({
    queryKey: ['ehr-timeline', id], enabled: !!id, retry: false,
    queryFn: () => ehrApi.timeline(id!), select: (r) => (r.data as any).data as any[],
  });
  const noBond = isNoBond(timelineQ.error);

  const bgMut = useMutation({
    mutationFn: (reason: string) => ehrApi.breakGlass(id!, reason),
    onSuccess: () => {
      toast.success('Acesso de emergência concedido (12h). Evento auditado.');
      qc.invalidateQueries({ queryKey: ['ehr-timeline', id] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="flex items-center gap-3">
        <button className="btn-ghost px-2 py-2" onClick={() => navigate('/patients')} title="Voltar">
          <ArrowLeft size={18} />
        </button>
        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--color-accent-subtle)', color: 'var(--cyan-500)' }}>
          <Stethoscope size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-xl text-slate-100 truncate">
            {patient ? patient.name : 'Prontuário'} <span className="text-slate-500 font-normal text-base">· Prontuário</span>
          </h1>
          <p className="text-slate-500 text-sm">
            {patient
              ? <>{genderLabel[patient.gender] ?? patient.gender ?? '—'} · {formatAge(patient.birth_date)}
                  {patient.medical_record_number ? ` · Prontuário ${patient.medical_record_number}` : ''}</>
              : 'Carregando…'}
          </p>
        </div>
      </header>

      {noBond ? (
        <BreakGlassPanel onSubmit={(reason) => bgMut.mutate(reason)} pending={bgMut.isPending} />
      ) : (
        <>
          <AllergyBanner patientId={id!} />
          <RiskBanner patientId={id!} />
          <ClinicalSummary patientId={id!} />

          <div className="flex border-b border-navy-800/50 overflow-x-auto">
            <TabBtn active={tab === 'timeline'}      onClick={() => setTab('timeline')}      icon={CalendarClock} label="Linha do tempo" />
            <TabBtn active={tab === 'encounters'}    onClick={() => setTab('encounters')}    icon={ClipboardList} label="Atendimentos" />
            <TabBtn active={tab === 'problems'}      onClick={() => setTab('problems')}      icon={ListChecks}    label="Problemas" />
            <TabBtn active={tab === 'allergies'}     onClick={() => setTab('allergies')}     icon={ShieldAlert}   label="Alergias" />
            <TabBtn active={tab === 'adverse'}       onClick={() => setTab('adverse')}       icon={ShieldAlert}   label="Farmacovig." />
            <TabBtn active={tab === 'medications'}   onClick={() => setTab('medications')}   icon={Pill}          label="Medicamentos" />
            <TabBtn active={tab === 'prescriptions'} onClick={() => setTab('prescriptions')} icon={FileText}      label="Prescrições" />
            <TabBtn active={tab === 'sadt'}          onClick={() => setTab('sadt')}          icon={FlaskConical}  label="Exames (SADT)" />
            <TabBtn active={tab === 'certificates'}  onClick={() => setTab('certificates')}  icon={FileSignature} label="Atestados" />
            <TabBtn active={tab === 'immunizations'} onClick={() => setTab('immunizations')} icon={Syringe}       label="Vacinas" />
            <TabBtn active={tab === 'attachments'}   onClick={() => setTab('attachments')}   icon={Paperclip}     label="Anexos" />
            <TabBtn active={tab === 'history'}       onClick={() => setTab('history')}       icon={BookOpen}      label="Antecedentes" />
            <TabBtn active={tab === 'vitals'}        onClick={() => setTab('vitals')}        icon={Activity}      label="Sinais vitais" />
            <TabBtn active={tab === 'scales'}        onClick={() => setTab('scales')}        icon={ListChecks}    label="Escalas" />
            <TabBtn active={tab === 'nursing'}       onClick={() => setTab('nursing')}       icon={ClipboardPlus} label="Evolução Enf." />
          </div>

          {tab === 'timeline'      && <TimelineTab patientId={id!} q={timelineQ} />}
          {tab === 'encounters'    && <EncountersTab patientId={id!} />}
          {tab === 'problems'      && <ProblemsTab patientId={id!} />}
          {tab === 'allergies'     && <AllergiesTab patientId={id!} />}
          {tab === 'medications'   && <MedicationsTab patientId={id!} />}
          {tab === 'prescriptions' && <PrescriptionsTab patientId={id!} />}
          {tab === 'certificates'  && <CertificatesTab patientId={id!} />}
          {tab === 'immunizations' && <ImmunizationsTab patientId={id!} />}
          {tab === 'attachments'   && <AttachmentsTab patientId={id!} />}
          {tab === 'history'       && <HistoryTab patientId={id!} />}
          {tab === 'vitals'        && <VitalsTab patientId={id!} />}
          {tab === 'scales'        && <NursingScalesTab patientId={id!} />}
          {tab === 'nursing'       && <NursingEvolutionTab patientId={id!} />}
          {tab === 'sadt'          && <ServiceRequestsTab patientId={id!} />}
          {tab === 'adverse'       && <AdverseEventsTab patientId={id!} />}
        </>
      )}
    </div>
  );
}

function BreakGlassPanel({ onSubmit, pending }: { onSubmit: (reason: string) => void; pending: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <div className="card p-6 max-w-xl mx-auto text-center space-y-4">
      <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center bg-amber-950/40 border border-amber-800/50">
        <ShieldAlert size={26} className="text-amber-400" />
      </div>
      <div>
        <h2 className="font-display font-semibold text-slate-100 text-lg">Sem vínculo clínico</h2>
        <p className="text-slate-400 text-sm mt-1">
          Você não tem atendimento registrado com este paciente. Para acessar o prontuário,
          registre uma <strong className="text-amber-300">quebra de sigilo (break-glass)</strong> com
          justificativa — o acesso vale 12h e é auditado.
        </p>
      </div>
      <Field label="Justificativa">
        <textarea className="input resize-none" rows={3} value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: paciente em atendimento de urgência; preciso consultar histórico." />
      </Field>
      <button className="btn-primary w-full justify-center" disabled={pending || reason.trim().length < 5}
        onClick={() => onSubmit(reason.trim())}>
        {pending ? <Spinner size={14} /> : <><Lock size={14} /> Quebrar sigilo e acessar</>}
      </button>
    </div>
  );
}

const EVENT_META: Record<string, { icon: any; label: string; color: string }> = {
  encounter: { icon: ClipboardList, label: 'Atendimento', color: 'var(--cyan-500)' },
  note:      { icon: FileSignature, label: 'Evolução',    color: '#10b981' },
  study:     { icon: Image,         label: 'Exame',       color: '#6366f1' },
  report:    { icon: FileText,      label: 'Laudo',       color: '#a855f7' },
  vitals:    { icon: HeartPulse,    label: 'Sinais vitais', color: '#f43f5e' },
};
function TimelineTab({ q }: { patientId: string; q: any }) {
  if (q.isLoading) return <div className="p-8 text-center"><Spinner /></div>;
  const events: any[] = q.data ?? [];
  if (!events.length) return <EmptyState icon={CalendarClock} title="Sem eventos clínicos"
    description="Atendimentos, evoluções, exames e laudos aparecerão aqui em ordem cronológica." />;
  return (
    <div className="card divide-y divide-navy-800/40">
      {events.map((ev) => {
        const m = EVENT_META[ev.type] ?? EVENT_META.encounter;
        const Icon = m.icon;
        return (
          <div key={`${ev.type}-${ev.id}`} className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'var(--bg-overlay)', color: m.color }}>
              <Icon size={15} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-200">
                <span className="text-slate-400">{m.label}</span>
                {ev.title ? ` · ${ev.title}` : ''}
                {ev.actor ? <span className="text-slate-500"> — {ev.actor}</span> : ''}
              </p>
              <p className="text-xs text-slate-500">{formatDateTime(ev.at)}</p>
            </div>
            {ev.status && <span className="badge badge-neutral text-xs">{ev.status}</span>}
          </div>
        );
      })}
    </div>
  );
}

function EncountersTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ['ehr-encounters', patientId],
    queryFn: () => ehrApi.listEncounters(patientId), select: (r) => (r.data as any).data as any[],
  });

  const createMut = useMutation({
    mutationFn: (data: { encounter_type: string; chief_complaint?: string }) =>
      ehrApi.createEncounter({ patient_id: patientId, ...data }),
    onSuccess: (r) => {
      toast.success('Atendimento aberto');
      qc.invalidateQueries({ queryKey: ['ehr-encounters', patientId] });
      qc.invalidateQueries({ queryKey: ['ehr-timeline', patientId] });
      setOpen(false);
      setSelected((r.data as any).data.id);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Novo atendimento</button>
      </div>

      {listQ.isLoading ? <div className="p-8 text-center"><Spinner /></div>
        : !(listQ.data?.length) ? <EmptyState icon={ClipboardList} title="Nenhum atendimento"
            description="Abra um atendimento para registrar evolução, problemas e sinais vitais." />
        : (
          <div className="space-y-2">
            {listQ.data!.map((e) => (
              <div key={e.id}>
                <button onClick={() => setSelected(selected === e.id ? null : e.id)}
                  className="card w-full flex items-center gap-3 px-4 py-3 text-left hover:border-cyan-700/50 transition-colors">
                  <ChevronRight size={16} className={`text-slate-500 transition-transform ${selected === e.id ? 'rotate-90' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200">{ENCOUNTER_TYPES[e.encounter_type] ?? e.encounter_type}
                      <span className="text-slate-500"> · {e.professional_name ?? '—'}</span></p>
                    <p className="text-xs text-slate-500">{formatDateTime(e.started_at)} · {e.notes_count} evolução(ões)</p>
                  </div>
                  <span className={`badge ${e.status === 'open' ? 'badge-warning' : 'badge-neutral'} text-xs`}>
                    {e.status === 'open' ? 'Aberto' : e.status === 'closed' ? 'Encerrado' : e.status}
                  </span>
                </button>
                {selected === e.id && <EncounterDetail encounterId={e.id} patientId={patientId} />}
              </div>
            ))}
          </div>
        )}

      <Modal open={open} onClose={() => setOpen(false)} title="Novo atendimento" size="sm">
        <NewEncounterForm onSubmit={(d) => createMut.mutate(d)} pending={createMut.isPending} />
      </Modal>
    </div>
  );
}

function NewEncounterForm({ onSubmit, pending }: { onSubmit: (d: { encounter_type: string; chief_complaint?: string }) => void; pending: boolean }) {
  const [type, setType] = useState('ambulatorial');
  const [cc, setCc] = useState('');
  return (
    <div className="space-y-3">
      <Field label="Tipo de atendimento">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(ENCOUNTER_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label="Queixa principal (opcional)">
        <textarea className="input resize-none" rows={3} value={cc} onChange={(e) => setCc(e.target.value)}
          placeholder="Motivo do atendimento relatado pelo paciente." />
      </Field>
      <div className="flex justify-end pt-2 border-t border-navy-700">
        <button className="btn-primary" disabled={pending}
          onClick={() => onSubmit({ encounter_type: type, chief_complaint: cc.trim() || undefined })}>
          {pending ? <Spinner size={14} /> : 'Abrir atendimento'}
        </button>
      </div>
    </div>
  );
}

function EncounterDetail({ encounterId, patientId }: { encounterId: string; patientId: string }) {
  const qc = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [editNote, setEditNote] = useState<any | null>(null);
  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [amendFor, setAmendFor] = useState<string | null>(null);

  const detailQ = useQuery({
    queryKey: ['ehr-encounter', encounterId],
    queryFn: () => ehrApi.getEncounter(encounterId), select: (r) => (r.data as any).data,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ehr-encounter', encounterId] });
    qc.invalidateQueries({ queryKey: ['ehr-encounters', patientId] });
    qc.invalidateQueries({ queryKey: ['ehr-timeline', patientId] });
    qc.invalidateQueries({ queryKey: ['ehr-vitals', patientId] });
  };

  const signMut = useMutation({
    mutationFn: (noteId: string) => ehrApi.signNote(noteId),
    onSuccess: () => { toast.success('Evolução assinada'); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const amendMut = useMutation({
    mutationFn: ({ noteId, reason }: { noteId: string; reason: string }) => ehrApi.amendNote(noteId, reason),
    onSuccess: () => { toast.success('Evolução reaberta para emenda'); setAmendFor(null); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const closeMut = useMutation({
    mutationFn: () => ehrApi.closeEncounter(encounterId),
    onSuccess: () => { toast.success('Atendimento encerrado'); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (detailQ.isLoading) return <div className="p-6 text-center"><Spinner /></div>;
  const d = detailQ.data;
  if (!d) return null;
  const isOpen = d.status === 'open';

  return (
    <div className="ml-7 mt-2 mb-1 card p-4 space-y-4 border-navy-700/60">
      {d.chief_complaint && (
        <p className="text-sm text-slate-300"><span className="text-slate-500">Queixa principal:</span> {d.chief_complaint}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {isOpen && <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => { setEditNote(null); setNoteOpen(true); }}>
          <Plus size={13} /> Nova evolução</button>}
        {isOpen && <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setVitalsOpen(true)}>
          <HeartPulse size={13} /> Sinais vitais</button>}
        {isOpen && <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => closeMut.mutate()} disabled={closeMut.isPending}>
          Encerrar atendimento</button>}
      </div>

      <div className="space-y-2">
        {!(d.notes?.length) ? <p className="text-xs text-slate-500">Nenhuma evolução.</p>
          : d.notes.map((n: any) => (
            <div key={n.id} className="rounded-lg border border-navy-800/60 p-3 bg-navy-900/30">
              <div className="flex items-center justify-between mb-2">
                <span className={`badge ${NOTE_BADGE[n.status]} text-xs`}>{NOTE_LABEL[n.status] ?? n.status}</span>
                <div className="flex gap-1">
                  {n.status === 'draft' && (
                    <>
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setEditNote(n); setNoteOpen(true); }}>
                        <Edit3 size={12} /> Editar</button>
                      <button className="btn-primary px-2 py-1 text-xs" onClick={() => signMut.mutate(n.id)} disabled={signMut.isPending}>
                        <FileSignature size={12} /> Assinar</button>
                    </>
                  )}
                  {(n.status === 'signed' || n.status === 'amended') && (
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAmendFor(n.id)}>
                      <Edit3 size={12} /> Emendar</button>
                  )}
                </div>
              </div>
              <SoapView note={n} />
              {n.status === 'amended' && <NoteAuditTrail noteId={n.id} />}
            </div>
          ))}
      </div>

      {d.vitals?.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1">Sinais vitais</p>
          <div className="flex flex-wrap gap-2">
            {d.vitals.map((v: any) => <VitalsChip key={v.id} v={v} />)}
          </div>
        </div>
      )}

      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title={editNote ? 'Editar evolução' : 'Nova evolução (SOAP)'} size="lg">
        <NoteEditor encounterId={encounterId} note={editNote} onDone={() => { setNoteOpen(false); invalidate(); }} />
      </Modal>
      <Modal open={vitalsOpen} onClose={() => setVitalsOpen(false)} title="Registrar sinais vitais" size="md">
        <VitalsForm encounterId={encounterId} onDone={() => { setVitalsOpen(false); invalidate(); }} />
      </Modal>
      <Modal open={!!amendFor} onClose={() => setAmendFor(null)} title="Emendar evolução assinada" size="sm">
        <AmendForm onSubmit={(reason) => amendFor && amendMut.mutate({ noteId: amendFor, reason })} pending={amendMut.isPending} />
      </Modal>
    </div>
  );
}

function SoapView({ note }: { note: any }) {
  const row = (label: string, body?: string) => body
    ? <p className="text-xs text-slate-300"><span className="text-slate-500 font-medium">{label}:</span> {body}</p> : null;
  return (
    <div className="space-y-1">
      {row('S', note.subjective)}
      {row('O', note.objective)}
      {row('A', note.assessment)}
      {row('P', note.plan)}
      {(note.cid10_codes?.length > 0) && (
        <p className="text-xs text-slate-400">CID: {note.cid10_codes.map((c: any) => c.code).join(', ')}</p>
      )}
      {(note.status === 'signed' || note.status === 'amended') && (
        <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1 flex-wrap">
          <Lock size={10} className="text-emerald-500" />
          Documento assinado — imutável{note.signed_at ? ` em ${formatDateTime(note.signed_at)}` : ''}. Alterações somente por adendo.
          {note.signature_hash && <span className="text-slate-600 font-mono">· {String(note.signature_hash).slice(0, 10)}</span>}
        </p>
      )}
    </div>
  );
}

function NoteAuditTrail({ noteId }: { noteId: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['ehr-note-versions', noteId], enabled: open,
    queryFn: () => ehrApi.noteVersions(noteId).then((r) => (r.data as any).data as any[]),
  });
  const versions = q.data ?? [];
  return (
    <div className="mt-2 border-t border-navy-800/60 pt-2">
      <button className="text-[11px] text-amber-400/90 hover:text-amber-300 flex items-center gap-1" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} /> Histórico de adendos{open ? '' : ' (rastreável)'}
      </button>
      {open && (q.isLoading ? <p className="text-[11px] text-slate-500 mt-1">Carregando…</p>
        : !versions.length ? <p className="text-[11px] text-slate-500 mt-1">Sem versões anteriores.</p>
          : <div className="space-y-2 mt-2">
            {versions.map((v) => (
              <div key={v.version} className="rounded border border-navy-800 bg-navy-900/40 p-2">
                <p className="text-[11px] text-slate-400">
                  <span className="badge badge-neutral text-[10px] mr-1">v{v.version}</span>
                  {v.changed_by_name ?? '—'} · {formatDateTime(v.created_at)}
                </p>
                {v.change_reason && <p className="text-[11px] text-amber-300/80 mt-0.5">Motivo: {v.change_reason}</p>}
                <div className="text-[11px] text-slate-500 mt-1 space-y-0.5">
                  {v.snapshot?.subjective && <p><span className="text-slate-600">S:</span> {v.snapshot.subjective}</p>}
                  {v.snapshot?.objective && <p><span className="text-slate-600">O:</span> {v.snapshot.objective}</p>}
                  {v.snapshot?.assessment && <p><span className="text-slate-600">A:</span> {v.snapshot.assessment}</p>}
                  {v.snapshot?.plan && <p><span className="text-slate-600">P:</span> {v.snapshot.plan}</p>}
                </div>
              </div>
            ))}
          </div>)}
    </div>
  );
}

function NoteEditor({ encounterId, note, onDone }: { encounterId: string; note: any | null; onDone: () => void }) {
  const [s, setS] = useState(note?.subjective ?? '');
  const [o, setO] = useState(note?.objective ?? '');
  const [a, setA] = useState(note?.assessment ?? '');
  const [p, setP] = useState(note?.plan ?? '');
  const [cids, setCids] = useState<any[]>(note?.cid10_codes ?? []);

  const applyTemplate = (t: SoapTemplate) => {
    setS((v: string) => appendText(v, t.s)); setO((v: string) => appendText(v, t.o));
    setA((v: string) => appendText(v, t.a)); setP((v: string) => appendText(v, t.p));
  };

  const mut = useMutation({
    mutationFn: () => {
      const body: SoapInput = {
        subjective: s || undefined, objective: o || undefined,
        assessment: a || undefined, plan: p || undefined,
        cid10_codes: cids.length ? cids : undefined,
      };
      return note ? ehrApi.updateNote(note.id, body) : ehrApi.createNote(encounterId, body);
    },
    onSuccess: () => { toast.success(note ? 'Evolução atualizada' : 'Evolução criada'); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-3">
      <SoapTemplateBar onPick={applyTemplate} />
      <Field label="Subjetivo (S) — queixa/história"><MarkdownTextarea value={s} onChange={setS} rows={3} placeholder="Relato do paciente…" /></Field>
      <Field label="Objetivo (O) — exame físico/achados"><MarkdownTextarea value={o} onChange={setO} rows={3} placeholder="Exame físico, sinais…" /></Field>
      <Field label="Avaliação (A) — hipóteses/diagnóstico"><MarkdownTextarea value={a} onChange={setA} rows={3} placeholder="Hipóteses diagnósticas…" /></Field>
      <Field label="Plano (P) — conduta"><MarkdownTextarea value={p} onChange={setP} rows={3} placeholder="Conduta, exames, prescrição…" /></Field>
      <Field label="CID-10 (avaliação)">
        <CidPicker value={null} onChange={(c) => { if (c && !cids.find((x) => x.code === c.code)) setCids([...cids, c]); }} />
        {cids.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {cids.map((c) => (
              <span key={c.code} className="badge badge-info text-xs">{c.code}
                <button className="ml-1 text-slate-400 hover:text-slate-100" onClick={() => setCids(cids.filter((x) => x.code !== c.code))}>×</button>
              </span>
            ))}
          </div>
        )}
      </Field>
      <div className="flex justify-end gap-2 pt-2 border-t border-navy-700">
        <button className="btn-primary" disabled={mut.isPending || !(s || o || a || p)} onClick={() => mut.mutate()}>
          {mut.isPending ? <Spinner size={14} /> : (note ? 'Salvar' : 'Criar rascunho')}
        </button>
      </div>
    </div>
  );
}

function AmendForm({ onSubmit, pending }: { onSubmit: (reason: string) => void; pending: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">A versão assinada será arquivada no histórico; a evolução volta a rascunho para edição.</p>
      <Field label="Motivo da emenda">
        <textarea className="input resize-none" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: correção de dose; complemento de exame físico." />
      </Field>
      <div className="flex justify-end pt-2 border-t border-navy-700">
        <button className="btn-danger" disabled={pending || reason.trim().length < 5} onClick={() => onSubmit(reason.trim())}>
          {pending ? <Spinner size={14} /> : 'Reabrir para emenda'}
        </button>
      </div>
    </div>
  );
}

const VITAL_DEFS: { key: keyof VitalsInput; label: string; unit: string; step?: string }[] = [
  { key: 'systolic', label: 'PA sistólica', unit: 'mmHg' },
  { key: 'diastolic', label: 'PA diastólica', unit: 'mmHg' },
  { key: 'heart_rate', label: 'FC', unit: 'bpm' },
  { key: 'resp_rate', label: 'FR', unit: 'irpm' },
  { key: 'temp_c', label: 'Temperatura', unit: '°C', step: '0.1' },
  { key: 'spo2', label: 'SpO₂', unit: '%' },
  { key: 'weight_kg', label: 'Peso', unit: 'kg', step: '0.1' },
  { key: 'height_cm', label: 'Altura', unit: 'cm', step: '0.1' },
  { key: 'glucose_mgdl', label: 'Glicemia', unit: 'mg/dL' },
  { key: 'pain_scale', label: 'Dor (0–10)', unit: '' },
];
function VitalsForm({ encounterId, onDone }: { encounterId: string; onDone: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const mut = useMutation({
    mutationFn: () => {
      const body: VitalsInput = {};
      for (const { key } of VITAL_DEFS) {
        const raw = vals[key as string];
        if (raw !== undefined && raw !== '') (body as any)[key] = Number(raw);
      }
      return ehrApi.createVitals(encounterId, body);
    },
    onSuccess: () => { toast.success('Sinais vitais registrados'); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const anyVal = Object.values(vals).some((v) => v !== '');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {VITAL_DEFS.map(({ key, label, unit, step }) => (
          <Field key={key as string} label={`${label}${unit ? ` (${unit})` : ''}`}>
            <input className="input" type="number" step={step ?? '1'} value={vals[key as string] ?? ''}
              onChange={(e) => setVals((p) => ({ ...p, [key]: e.target.value }))} />
          </Field>
        ))}
      </div>
      <div className="flex justify-end pt-2 border-t border-navy-700">
        <button className="btn-primary" disabled={mut.isPending || !anyVal} onClick={() => mut.mutate()}>
          {mut.isPending ? <Spinner size={14} /> : 'Registrar'}
        </button>
      </div>
    </div>
  );
}
function VitalsChip({ v }: { v: any }) {
  const parts: string[] = [];
  if (v.systolic && v.diastolic) parts.push(`PA ${v.systolic}/${v.diastolic}`);
  if (v.heart_rate) parts.push(`FC ${v.heart_rate}`);
  if (v.temp_c) parts.push(`T ${v.temp_c}°`);
  if (v.spo2) parts.push(`SpO₂ ${v.spo2}%`);
  if (v.bmi) parts.push(`IMC ${v.bmi}`);
  if (v.pain_scale != null) parts.push(`Dor ${v.pain_scale}`);
  return <span className="badge badge-neutral text-xs" title={formatDateTime(v.measured_at)}>{parts.join(' · ') || 'registro'}</span>;
}
function VitalsTab({ patientId }: { patientId: string }) {
  const q = useQuery({
    queryKey: ['ehr-vitals', patientId],
    queryFn: () => ehrApi.listVitals(patientId), select: (r) => (r.data as any).data as any[],
  });
  if (q.isLoading) return <div className="p-8 text-center"><Spinner /></div>;
  const rows = q.data ?? [];
  if (!rows.length) return <EmptyState icon={Activity} title="Sem sinais vitais"
    description="Os sinais vitais são registrados dentro de um atendimento (aba Atendimentos)." />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-navy-900/50 border-b border-navy-800/40">
          <tr>{['Data', 'PA', 'FC', 'FR', 'T °C', 'SpO₂', 'Peso', 'Altura', 'IMC', 'Glic.', 'Dor'].map((h) => (
            <th key={h} className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">{h}</th>))}</tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-b border-navy-800/30 text-slate-300">
              <td className="px-3 py-2 whitespace-nowrap text-xs">{formatDateTime(v.measured_at)}</td>
              <td className="px-3 py-2">{v.systolic && v.diastolic ? `${v.systolic}/${v.diastolic}` : '—'}</td>
              <td className="px-3 py-2">{v.heart_rate ?? '—'}</td>
              <td className="px-3 py-2">{v.resp_rate ?? '—'}</td>
              <td className="px-3 py-2">{v.temp_c ?? '—'}</td>
              <td className="px-3 py-2">{v.spo2 ?? '—'}</td>
              <td className="px-3 py-2">{v.weight_kg ?? '—'}</td>
              <td className="px-3 py-2">{v.height_cm ?? '—'}</td>
              <td className="px-3 py-2">{v.bmi ?? '—'}</td>
              <td className="px-3 py-2">{v.glucose_mgdl ?? '—'}</td>
              <td className="px-3 py-2">{v.pain_scale ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PROBLEM_BADGE: Record<string, string> = { active: 'badge-warning', resolved: 'badge-success', inactive: 'badge-neutral' };
const PROBLEM_LABEL: Record<string, string> = { active: 'Ativo', resolved: 'Resolvido', inactive: 'Inativo' };
function ProblemsTab({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['ehr-problems', patientId],
    queryFn: () => ehrApi.listProblems(patientId), select: (r) => (r.data as any).data as any[],
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ehr-problems', patientId] });
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      ehrApi.updateProblem(id, { status, ...(status === 'resolved' ? { resolved_date: new Date().toISOString().slice(0, 10) } : {}) }),
    onSuccess: () => { toast.success('Problema atualizado'); invalidate(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Adicionar problema</button>
      </div>
      {q.isLoading ? <div className="p-8 text-center"><Spinner /></div>
        : !(q.data?.length) ? <EmptyState icon={ListChecks} title="Lista de problemas vazia"
            description="Diagnósticos e condições ativas/crônicas do paciente." />
        : (
          <div className="space-y-2">
            {q.data!.map((p) => (
              <div key={p.id} className="card flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200">
                    {p.title}
                    {p.is_chronic && <span className="badge badge-info text-xs ml-2">Crônico</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.cid10_code ? `${p.cid10_code}${p.cid10_description ? ' — ' + p.cid10_description : ''} · ` : ''}
                    {p.onset_date ? `início ${formatDate(p.onset_date)}` : ''}
                  </p>
                </div>
                <span className={`badge ${PROBLEM_BADGE[p.status]} text-xs`}>{PROBLEM_LABEL[p.status] ?? p.status}</span>
                {p.status === 'active' && (
                  <button className="btn-ghost px-2 py-1 text-xs" disabled={statusMut.isPending}
                    onClick={() => statusMut.mutate({ id: p.id, status: 'resolved' })}>Resolver</button>
                )}
              </div>
            ))}
          </div>
        )}
      <Modal open={open} onClose={() => setOpen(false)} title="Adicionar problema" size="md">
        <ProblemForm patientId={patientId} onDone={() => { setOpen(false); invalidate(); }} />
      </Modal>
    </div>
  );
}

function ProblemForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [cid, setCid] = useState<{ code: string; description?: string } | null>(null);
  const [chronic, setChronic] = useState(false);
  const [onset, setOnset] = useState('');
  const mut = useMutation({
    mutationFn: () => ehrApi.createProblem({
      patient_id: patientId, title: title.trim(),
      cid10_code: cid?.code, is_chronic: chronic, onset_date: onset || undefined,
    }),
    onSuccess: () => { toast.success('Problema adicionado'); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <Field label="Título" required>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Hipertensão arterial sistêmica" />
      </Field>
      <Field label="CID-10 (opcional)"><CidPicker value={cid} onChange={setCid} onPickTitle={(t) => !title && setTitle(t)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Início (opcional)">
          <input className="input" type="date" value={onset} onChange={(e) => setOnset(e.target.value)} />
        </Field>
        <Field label="Crônico">
          <label className="flex items-center gap-2 mt-2 text-sm text-slate-300">
            <input type="checkbox" checked={chronic} onChange={(e) => setChronic(e.target.checked)} /> Condição crônica
          </label>
        </Field>
      </div>
      <div className="flex justify-end pt-2 border-t border-navy-700">
        <button className="btn-primary" disabled={mut.isPending || title.trim().length < 1} onClick={() => mut.mutate()}>
          {mut.isPending ? <Spinner size={14} /> : 'Adicionar'}
        </button>
      </div>
    </div>
  );
}

function CidPicker({ value, onChange, onPickTitle }: {
  value: { code: string; description?: string } | null;
  onChange: (v: { code: string; description?: string } | null) => void;
  onPickTitle?: (t: string) => void;
}) {
  const [q, setQ] = useState('');
  const searchQ = useQuery({
    queryKey: ['cid10', q], enabled: q.trim().length >= 2,
    queryFn: () => catalogApi.cid10(q.trim()), select: (r) => (r.data as any).data as any[],
  });
  if (value) {
    return (
      <div className="flex items-center justify-between input">
        <span className="text-sm text-slate-200">{value.code} — {value.description}</span>
        <button className="text-slate-500 hover:text-slate-200 text-xs" onClick={() => onChange(null)}>trocar</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código ou descrição…" />
      {q.trim().length >= 2 && (searchQ.data?.length ?? 0) > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto card p-1">
          {searchQ.data!.slice(0, 12).map((c) => (
            <button key={c.code} className="block w-full text-left px-2 py-1.5 text-xs text-slate-300 hover:bg-navy-800 rounded"
              onClick={() => { onChange({ code: c.code, description: c.description }); onPickTitle?.(c.description); }}>
              <span className="font-mono text-cyan-400">{c.code}</span> — {c.description}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap
        ${active ? 'text-cyan-400 border-b-2 border-cyan-500' : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent'}`}>
      <Icon size={14} /> {label}
    </button>
  );
}
