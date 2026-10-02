import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Stethoscope, AlertTriangle, Plus, Trash2, Pill, CheckCircle2, ArrowLeft,
  HeartPulse, ShieldAlert, FileText, ExternalLink,
} from 'lucide-react';
import { ehrApi } from '../../api/endpoints';
import { Spinner, Field, Select, ConfirmDialog } from '../../components/ui';
import { SoapTemplateBar, appendText, type SoapTemplate } from '../../components/SoapTemplates';
import { ClinicalSummary, RiskBanner } from '../patients/PatientChartF2';
import { PosologyDatalists, POSOLOGY_LIST } from '../../components/posology';
import { CatalogInput } from '../../components/CatalogInput';
import { DrugSafetyBanner } from '../../components/DrugSafetyBanner';
import { toast } from '../../components/ui/Toast';
import { getErrorMessage } from '../../utils/format';

const ENC_TYPE: Record<string, string> = { ambulatorial: 'Ambulatorial', urgencia: 'Urgência', retorno: 'Retorno', teleconsulta: 'Teleconsulta' };
const SEVERITY: Record<string, { label: string; cls: string }> = {
  severe:   { label: 'Grave',     cls: 'text-red-300 bg-red-500/15 border-red-500/40' },
  moderate: { label: 'Moderada',  cls: 'text-amber-300 bg-amber-500/15 border-amber-500/40' },
  mild:     { label: 'Leve',      cls: 'text-sky-300 bg-sky-500/15 border-sky-500/40' },
  unknown:  { label: 'Desconhecida', cls: 'text-slate-300 bg-navy-800 border-navy-600' },
};

type RxItem = {
  drug_name: string; dose: string; route: string; frequency: string; duration: string;
  administer_at_unit: boolean;
};
const emptyItem = (): RxItem => ({ drug_name: '', dose: '', route: '', frequency: '', duration: '', administer_at_unit: false });

export default function AtendimentoConsultaPage() {
  const { encounterId } = useParams<{ encounterId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const loc = useLocation();
  const navState = (loc.state ?? {}) as { patientName?: string; isEmergency?: boolean };

  const encQ = useQuery({
    queryKey: ['enc', encounterId],
    queryFn: () => ehrApi.getEncounter(encounterId!).then((r) => (r.data as any).data),
    enabled: !!encounterId,
  });
  const patientId: string | undefined = encQ.data?.patient_id;

  // Move o card para "Em atendimento" ao abrir a consulta.
  useEffect(() => {
    if (encounterId) ehrApi.advanceEpisode(encounterId, 'in_consultation').catch(() => {});
  }, [encounterId]);

  const allergyQ = useQuery({
    queryKey: ['enc-allergies', patientId],
    queryFn: () => ehrApi.allergies(patientId!).then((r) => (r.data as any).data as any[]),
    enabled: !!patientId,
  });

  const lastVitals = useMemo(() => {
    const v = encQ.data?.vitals as any[] | undefined;
    return v && v.length ? v[v.length - 1] : null;
  }, [encQ.data]);

  const [subjective, setSubjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');
  useEffect(() => { if (encQ.data?.chief_complaint && !subjective) setSubjective(encQ.data.chief_complaint); }, [encQ.data]);
  // Consulta-lite não tem campo Objetivo separado: o template mescla O+A no campo de avaliação
  const applyTemplate = (t: SoapTemplate) => {
    setSubjective((v) => appendText(v, t.s));
    setAssessment((v) => appendText(appendText(v, t.o), t.a));
    setPlan((v) => appendText(v, t.p));
  };

  const [items, setItems] = useState<RxItem[]>([emptyItem()]);
  const setItem = (i: number, patch: Partial<RxItem>) => setItems((p) => p.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const filledItems = items.filter((it) => it.drug_name.trim());
  const hasUnitMed = filledItems.some((it) => it.administer_at_unit);

  const [alg, setAlg] = useState({ allergen: '', severity: 'moderate', reaction: '' });
  const addAllergy = useMutation({
    mutationFn: () => ehrApi.createAllergy({
      patient_id: patientId, encounter_id: encounterId,
      allergen: alg.allergen.trim(), allergen_type: 'medication',
      severity: alg.severity, reaction: alg.reaction || undefined,
    }),
    onSuccess: () => { setAlg({ allergen: '', severity: 'moderate', reaction: '' }); qc.invalidateQueries({ queryKey: ['enc-allergies', patientId] }); toast.success('Alergia registrada'); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const [saving, setSaving] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const finish = async () => {
    if (!encounterId || !patientId) return;
    setSaving(true);
    try {
      if (subjective.trim() || assessment.trim() || plan.trim()) {
        const note = await ehrApi.createNote(encounterId, {
          subjective: subjective.trim() || undefined,
          assessment: assessment.trim() || undefined,
          plan: plan.trim() || undefined,
        } as any);
        const noteId = (note.data as any).data.id;
        await ehrApi.signNote(noteId).catch(() => {});
      }

      if (filledItems.length) {
        const rx = await ehrApi.createPrescription({
          patient_id: patientId, encounter_id: encounterId,
          items: filledItems.map((it) => ({
            drug_name: it.drug_name.trim(), dose: it.dose || undefined, route: it.route || undefined,
            frequency: it.frequency || undefined, duration: it.duration || undefined,
            administer_at_unit: it.administer_at_unit,
          })),
        });
        const rxData = (rx.data as any).data;
        const warnings: string[] = rxData.allergy_warnings ?? [];
        if (warnings.length) toast.error(`Atenção — alergia: ${warnings.join(', ')}`);
        await ehrApi.signPrescription(rxData.id);
      }

      // Se houver item para administrar na unidade, roteia para a fila da enfermagem em vez de encerrar
      await ehrApi.advanceEpisode(encounterId, hasUnitMed ? 'medication' : 'completed');

      qc.invalidateQueries({ queryKey: ['ehr-queue'] });
      toast.success(hasUnitMed ? 'Atendimento concluído — enviado à medicação' : 'Atendimento concluído');
      navigate('/atendimento');
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (encQ.isLoading) return <div className="p-10 text-center"><Spinner /></div>;
  if (encQ.isError || !encQ.data) return <div className="p-10 text-center text-slate-400">Atendimento não encontrado. <Link to="/atendimento" className="text-cyan-400">Voltar ao painel</Link></div>;

  const allergies = allergyQ.data ?? [];
  const activeAllergies = allergies.filter((a) => a.status !== 'inactive' && a.status !== 'resolved');

  return (
    <div className="space-y-5 animate-fade-in max-w-4xl mx-auto pb-10">
      <div className="flex items-center gap-3">
        <button className="btn-ghost px-2" onClick={() => navigate('/atendimento')}><ArrowLeft size={16} /></button>
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8' }}>
          <Stethoscope size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-xl text-slate-100 truncate">
            {navState.patientName ?? 'Atendimento médico'}
            {navState.isEmergency && <span className="badge badge-danger text-xs ml-2"><AlertTriangle size={9} /> Emergência</span>}
          </h1>
          <p className="text-slate-500 text-sm">{ENC_TYPE[encQ.data.encounter_type] ?? encQ.data.encounter_type} · atendimento clínico</p>
        </div>
        {patientId && (
          <Link to={`/patients/${patientId}/chart`} className="btn-ghost text-xs">
            <ExternalLink size={13} /> Prontuário completo
          </Link>
        )}
      </div>

      {activeAllergies.some((a) => a.severity === 'severe') && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-red-700/50 bg-red-900/20 text-red-200 text-sm">
          <ShieldAlert size={16} /> Paciente com alergia GRAVE: {activeAllergies.filter((a) => a.severity === 'severe').map((a) => a.allergen).join(', ')}
        </div>
      )}

      <div className="card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1"><HeartPulse size={13} className="text-amber-400" /> Medições da triagem</p>
        {lastVitals ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-300">
            {lastVitals.systolic != null && <span>PA <b>{lastVitals.systolic}/{lastVitals.diastolic ?? '—'}</b> mmHg</span>}
            {lastVitals.heart_rate != null && <span>FC <b>{lastVitals.heart_rate}</b> bpm</span>}
            {lastVitals.resp_rate != null && <span>FR <b>{lastVitals.resp_rate}</b> irpm</span>}
            {lastVitals.temp_c != null && <span>Temp <b>{lastVitals.temp_c}</b> °C</span>}
            {lastVitals.spo2 != null && <span>SpO₂ <b>{lastVitals.spo2}</b>%</span>}
            {lastVitals.glucose_mgdl != null && <span>Glic <b>{lastVitals.glucose_mgdl}</b> mg/dL</span>}
            {lastVitals.pain_scale != null && <span>Dor <b>{lastVitals.pain_scale}</b>/10</span>}
          </div>
        ) : <p className="text-sm text-slate-500">Sem medições registradas na triagem.</p>}
      </div>

      {/* Resumo inline (problemas ativos + medicamentos em uso) para não precisar trocar de tela durante a consulta */}
      {patientId && <RiskBanner patientId={patientId} />}
      {patientId && <ClinicalSummary patientId={patientId} />}

      <div className="card p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1"><ShieldAlert size={13} className="text-red-400" /> Alergias</p>
        {activeAllergies.length ? (
          <div className="flex flex-wrap gap-2">
            {activeAllergies.map((a) => (
              <span key={a.id} className={`text-xs px-2 py-1 rounded border ${SEVERITY[a.severity]?.cls ?? SEVERITY.unknown.cls}`}>
                {a.allergen} · {SEVERITY[a.severity]?.label ?? a.severity}{a.reaction ? ` — ${a.reaction}` : ''}
              </span>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">Nenhuma alergia conhecida registrada.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] gap-2 items-end pt-1">
          <Field label="Alérgeno"><input className="input" value={alg.allergen} onChange={(e) => setAlg({ ...alg, allergen: e.target.value })} placeholder="Ex: Dipirona" /></Field>
          <Field label="Gravidade"><Select value={alg.severity} onChange={(e) => setAlg({ ...alg, severity: e.target.value })}><option value="mild">Leve</option><option value="moderate">Moderada</option><option value="severe">Grave</option><option value="unknown">Desconhecida</option></Select></Field>
          <Field label="Reação"><input className="input" value={alg.reaction} onChange={(e) => setAlg({ ...alg, reaction: e.target.value })} placeholder="Ex: urticária" /></Field>
          <button className="btn-ghost h-[42px]" disabled={!alg.allergen.trim() || addAllergy.isPending} onClick={() => addAllergy.mutate()}>
            {addAllergy.isPending ? <Spinner size={14} /> : <><Plus size={14} /> Add</>}
          </button>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1"><FileText size={13} className="text-cyan-400" /> Evolução clínica</p>
        <SoapTemplateBar onPick={applyTemplate} />
        <Field label="Queixa / história (dores, sintomas)"><textarea className="input resize-none" rows={2} value={subjective} onChange={(e) => setSubjective(e.target.value)} placeholder="O que o paciente relata…" /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Avaliação / hipótese"><textarea className="input resize-none" rows={2} value={assessment} onChange={(e) => setAssessment(e.target.value)} placeholder="Impressão diagnóstica…" /></Field>
          <Field label="Conduta / plano"><textarea className="input resize-none" rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="Conduta, orientações…" /></Field>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1"><Pill size={13} className="text-rose-400" /> Receita / medicação</p>
          <button className="btn-ghost text-xs" onClick={() => setItems((p) => [...p, emptyItem()])}><Plus size={13} /> Medicamento</button>
        </div>
        <DrugSafetyBanner patientId={patientId} drugNames={items.map((i) => i.drug_name)} />
        <PosologyDatalists />
        {items.map((it, i) => (
          <div key={i} className="rounded-lg border border-navy-700 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <CatalogInput kind="medications" value={it.drug_name} onChange={(v) => setItem(i, { drug_name: v })} placeholder="Medicamento (busca no catálogo)" />
              </div>
              {items.length > 1 && <button className="text-slate-500 hover:text-red-400" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}><Trash2 size={15} /></button>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <input className="input" value={it.dose} onChange={(e) => setItem(i, { dose: e.target.value })} placeholder="Dose" />
              <input className="input" list={POSOLOGY_LIST.route} value={it.route} onChange={(e) => setItem(i, { route: e.target.value })} placeholder="Via (EV/VO/IM)" />
              <input className="input" list={POSOLOGY_LIST.freq} value={it.frequency} onChange={(e) => setItem(i, { frequency: e.target.value })} placeholder="Frequência" />
              <input className="input" list={POSOLOGY_LIST.duration} value={it.duration} onChange={(e) => setItem(i, { duration: e.target.value })} placeholder="Duração" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={it.administer_at_unit} onChange={(e) => setItem(i, { administer_at_unit: e.target.checked })} />
              <Pill size={13} className="text-rose-400" /> Administrar na unidade (vai p/ fila da enfermagem)
            </label>
          </div>
        ))}
      </div>

      <div className="card flex items-center justify-between gap-3 p-3 sticky bottom-3">
        <p className="text-xs text-slate-500">
          {hasUnitMed ? 'Há medicamento p/ administrar na unidade → irá para a fila da enfermagem.' : 'Sem medicação na unidade → atendimento será concluído.'}
        </p>
        <button className="btn-primary" disabled={saving} onClick={() => setConfirmFinish(true)}>
          {saving ? <Spinner size={14} /> : <><CheckCircle2 size={15} /> Concluir atendimento</>}
        </button>
      </div>

      <ConfirmDialog
        open={confirmFinish}
        title="Concluir atendimento?"
        message={
          (filledItems.length || subjective.trim() || assessment.trim() || plan.trim()
            ? 'A evolução e a receita serão assinadas (não podem ser editadas depois, só por adendo). '
            : '') +
          (hasUnitMed ? 'O paciente irá para a fila da enfermagem.' : 'O atendimento será encerrado.')
        }
        loading={saving}
        onCancel={() => setConfirmFinish(false)}
        onConfirm={() => { setConfirmFinish(false); finish(); }}
      />
    </div>
  );
}
