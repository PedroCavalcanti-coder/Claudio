import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileImage, CheckCircle, XCircle, AlertCircle,
  Search, UserCheck, Calendar, ChevronRight, Loader2, RefreshCw, Plus,
} from 'lucide-react';
import { patientsApi, appointmentsApi, studiesApi, healthUnitsApi, lookupsApi } from '../../api/endpoints';
import { useAuthStore } from '../../stores/authStore';
import { SectionHeader, Alert, Spinner, Field } from '../../components/ui';
import { formatDateTime, formatBytes, modalityLabel } from '../../utils/format';

function formatCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3)  return d;
  if (d.length <= 6)  return `${d.slice(0,3)}.${d.slice(3)}`;
  if (d.length <= 9)  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}

function maskBirthDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const day   = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year  = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

const APPT_STATUS: Record<string, { label: string; cls: string }> = {
  scheduled:  { label: 'Agendado',       cls: 'text-sky-300 bg-sky-500/15 border-sky-500/30' },
  confirmed:  { label: 'Confirmado',     cls: 'text-indigo-300 bg-indigo-500/15 border-indigo-500/30' },
  checked_in: { label: 'Check-in feito', cls: 'text-violet-300 bg-violet-500/15 border-violet-500/30' },
  in_progress:{ label: 'Em andamento',   cls: 'text-amber-300 bg-amber-500/15 border-amber-500/30' },
};

function StepBadge({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${active ? 'opacity-100' : done ? 'opacity-70' : 'opacity-30'}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border
        ${active ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300'
         : done ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
         : 'bg-navy-800 border-navy-600 text-slate-500'}`}>
        {done ? <CheckCircle size={14} /> : n}
      </div>
      <span className={`text-sm font-medium hidden sm:block
        ${active ? 'text-cyan-300' : done ? 'text-emerald-400' : 'text-slate-500'}`}>
        {label}
      </span>
    </div>
  );
}

export default function DicomUploadPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [cpfInput, setCpfInput] = useState('');
  const [cpfSearch, setCpfSearch] = useState('');
  const [patient, setPatient] = useState<any>(null);
  const [patientError, setPatientError] = useState('');

  const [selectedAppt, setSelectedAppt] = useState<any>(null);

  const [files, setFiles]     = useState<File[]>([]);
  const [drag, setDrag]       = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);

  // Contexto de realização é editável pois o técnico pode ter operado em outra sala/equipamento além da sua lotação padrão
  const currentUser = useAuthStore(s => s.user);
  const [healthUnitId, setHealthUnitId] = useState<string>('');
  const [equipmentId,  setEquipmentId]  = useState<string>('');
  const [roomId,       setRoomId]       = useState<string>('');
  const [showContextDetails, setShowContextDetails] = useState(false);

  // Estes campos documentam a realização efetiva do exame, não os dados burocráticos do agendamento
  const [performedAt,        setPerformedAt]        = useState<string>('');
  const [complications,      setComplications]      = useState<string>('');
  const [performingPhysician,setPerformingPhysician]= useState<string>('');
  const [examQuality,        setExamQuality]        = useState<string>('');

  const patientSearchResult = useQuery({
    queryKey: ['upload-patient-search', cpfSearch],
    queryFn:  () => patientsApi.list({ q: cpfSearch, limit: 1, page: 1 }),
    enabled:  cpfSearch.length === 11,
    staleTime: 0,
  });

  // useEffect em vez de derivar direto do useQuery para evitar loop de re-render no setStep
  useEffect(() => {
    if (!patientSearchResult.data || cpfSearch.length !== 11) return;
    const found = (patientSearchResult.data as any)?.data?.data?.[0] ?? null;
    if (found) {
      setPatient(found);
      setPatientError('');
      setStep(2);
    } else if (!patientSearchResult.isFetching) {
      setPatientError('Paciente não encontrado. Verifique o CPF informado.');
    }
  }, [patientSearchResult.data, patientSearchResult.isFetching, cpfSearch]);

  // Não exige check-in prévio: o técnico escolhe entre todos os agendamentos ainda "vivos" do paciente
  const UPLOADABLE = ['scheduled', 'confirmed', 'checked_in', 'in_progress'];
  const { data: appointmentsData, isLoading: loadingAppts } = useQuery({
    queryKey: ['upload-appts', patient?.id],
    queryFn:  () => appointmentsApi.list({ patient_id: patient!.id, limit: 50, page: 1 }),
    enabled:  !!patient?.id,
    select:   r => ((r.data as any).data as any[]).filter(a => UPLOADABLE.includes(a.status)),
    staleTime: 0,
  });

  const [walkInProc, setWalkInProc] = useState('');
  const { data: procList = [] } = useQuery({
    queryKey: ['upload-procedures'],
    queryFn:  () => lookupsApi.procedures(),
    select:   r => (r.data as any).data ?? [],
    enabled:  step === 2,
    staleTime: 60_000,
  });
  const walkInMut = useMutation({
    mutationFn: () => appointmentsApi.walkIn({ patient_id: patient.id, procedure_id: walkInProc }),
    onSuccess: (res: any) => {
      const proc = (procList as any[]).find(p => p.id === walkInProc);
      handleSelectAppt({
        id: res.data.data.id,
        scheduled_at: res.data.data.scheduled_at,
        procedure_name: proc?.name ?? 'Atendimento avulso',
        modality_type: proc?.modality_type ?? null,
        duration_minutes: proc?.duration_minutes ?? 30,
      });
    },
  });

  const { data: myUnit } = useQuery({
    queryKey: ['my-health-unit'],
    queryFn:  () => healthUnitsApi.mine(),
    select:   r => (r.data as any).data,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (!healthUnitId && myUnit?.id) setHealthUnitId(myUnit.id);
  }, [myUnit, healthUnitId]);

  const { data: modalitiesList = [] } = useQuery({
    queryKey: ['unit-modalities', healthUnitId],
    queryFn:  () => healthUnitsApi.modalities(healthUnitId),
    select:   r => (r.data as any).data ?? [],
    enabled:  !!healthUnitId,
    staleTime: 60_000,
  });
  const { data: roomsList = [] } = useQuery({
    queryKey: ['unit-rooms', healthUnitId],
    queryFn:  () => healthUnitsApi.rooms(healthUnitId),
    select:   r => (r.data as any).data ?? [],
    enabled:  !!healthUnitId,
    staleTime: 60_000,
  });

  const [uploadPct, setUploadPct] = useState(0);
  const uploadMut = useMutation({
    mutationFn: () => {
      // Só envia os campos de contexto preenchidos; o backend usa o agendamento/JWT do técnico como fallback
      const meta: Record<string, unknown> = { appointment_id: selectedAppt.id };
      if (healthUnitId)  meta.health_unit_id   = healthUnitId;
      if (equipmentId)   meta.equipment_id     = equipmentId;
      if (roomId)        meta.room_id          = roomId;
      if (performedAt)         meta.performed_at         = new Date(performedAt).toISOString();
      if (complications)       meta.complications        = complications;
      if (performingPhysician) meta.performing_physician = performingPhysician;
      if (examQuality)         meta.exam_quality         = examQuality;
      // technician_user_id não é enviado — o backend sempre usa o usuário autenticado (req.user.sub), nunca confia no cliente
      setUploadPct(0);
      return studiesApi.uploadChunked(files, meta, setUploadPct);
    },
    onSuccess: (res: any) => {
      setUploadResult(res.data.data);
      setUploadPct(100);
      qc.invalidateQueries({ queryKey: ['studies-all'] });
      qc.invalidateQueries({ queryKey: ['studies-recent'] });
    },
  });

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const fmtBytes = (b: number) =>
    b > 1024 * 1024 * 1024 ? (b / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    : b > 1024 * 1024      ? (b / 1024 / 1024).toFixed(1)        + ' MB'
    :                        (b / 1024).toFixed(0)               + ' KB';

  const handleCpfChange = (v: string) => {
    setCpfInput(formatCpf(v));
    setPatientError('');
    setPatient(null);
  };

  const handleSearchPatient = () => {
    const digits = cpfInput.replace(/\D/g, '');
    if (digits.length !== 11) { setPatientError('Digite um CPF completo (11 dígitos).'); return; }
    setPatient(null);
    setPatientError('');
    setCpfSearch(digits);
  };

  const handleSelectAppt = (appt: any) => {
    setSelectedAppt(appt);
    setStep(3);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const dropped = Array.from(e.dataTransfer.files).filter(
      f => f.name.toLowerCase().endsWith('.dcm') || f.type === 'application/dicom'
    );
    setFiles(prev => [...prev, ...dropped]);
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []).filter(
      f => f.name.toLowerCase().endsWith('.dcm') || f.type === 'application/dicom'
    );
    setFiles(prev => [...prev, ...selected]);
    e.target.value = '';
  };

  const reset = () => {
    setStep(1); setCpfInput(''); setCpfSearch('');
    setPatient(null); setPatientError(''); setSelectedAppt(null);
    setFiles([]); setUploadResult(null);
    setPerformedAt(''); setComplications(''); setPerformingPhysician(''); setExamQuality('');
    uploadMut.reset();
  };

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  if (uploadResult) {
    const hasFailed = (uploadResult.files_failed ?? 0) > 0;
    return (
      <div className="p-6 animate-fade-in">
        <SectionHeader title="Upload DICOM" subtitle="Envio de imagens ao PACS" />
        <div className="max-w-lg mx-auto mt-10 card p-8 text-center space-y-5">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto border ${
            hasFailed
              ? 'bg-amber-900/30 border-amber-700/40'
              : 'bg-emerald-900/30 border-emerald-700/40'
          }`}>
            <CheckCircle size={32} className={hasFailed ? 'text-amber-400' : 'text-emerald-400'} />
          </div>
          <div>
            <p className="text-slate-100 font-display font-semibold text-lg">
              {hasFailed ? 'Upload com avisos' : 'Upload enviado ao Orthanc!'}
            </p>
            <p className="text-slate-400 text-sm mt-1">
              {uploadResult.files_uploaded} arquivo{uploadResult.files_uploaded !== 1 ? 's' : ''} enviado{uploadResult.files_uploaded !== 1 ? 's' : ''} •{' '}
              {uploadResult.series_count} série{uploadResult.series_count !== 1 ? 's' : ''}
            </p>
            {hasFailed && (
              <p className="text-amber-400 text-xs mt-1">
                {uploadResult.files_failed} arquivo{uploadResult.files_failed !== 1 ? 's' : ''} com falha
              </p>
            )}
            {(uploadResult.warnings ?? []).map((w: { code: string; message: string }) => (
              <div key={w.code} className="mt-3 p-3 rounded-lg text-xs text-left"
                style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: '1px solid currentColor' }}>
                ⚠ {w.message}
              </div>
            ))}
            <p className="text-slate-500 text-xs mt-2 font-mono break-all">{uploadResult.study_instance_uid}</p>
            <p className="text-slate-600 text-xs mt-1">
              O Orthanc processará as imagens automaticamente. O estudo aparecerá em Estudos em instantes.
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <button className="btn-ghost" onClick={reset}>Novo upload</button>
            <button className="btn-primary" onClick={() => navigate('/studies')}>
              Ver em Estudos
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <SectionHeader
        title="Upload DICOM"
        subtitle="Envie imagens de exame ao sistema vinculadas a um agendamento"
      />

      <div className="flex items-center gap-3">
        <StepBadge n={1} label="Identificar paciente" active={step === 1} done={step > 1} />
        <ChevronRight size={14} className="text-slate-600 shrink-0" />
        <StepBadge n={2} label="Selecionar exame"     active={step === 2} done={step > 2} />
        <ChevronRight size={14} className="text-slate-600 shrink-0" />
        <StepBadge n={3} label="Enviar arquivos"       active={step === 3} done={false}  />
      </div>

      {step === 1 && (
        <div className="card p-6 max-w-md space-y-4">
          <div className="flex items-center gap-2 text-cyan-400 mb-1">
            <Search size={16} />
            <span className="font-medium text-sm">Buscar paciente pelo CPF</span>
          </div>
          <Field label="CPF do paciente" required>
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono tracking-wider"
                placeholder="000.000.000-00"
                value={cpfInput}
                onChange={e => handleCpfChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearchPatient()}
                maxLength={14}
                autoFocus
              />
              <button
                className="btn-primary px-4 shrink-0"
                onClick={handleSearchPatient}
                disabled={patientSearchResult.isFetching || cpfInput.replace(/\D/g,'').length !== 11}
              >
                {patientSearchResult.isFetching ? <Spinner size={14} /> : <Search size={14} />}
              </button>
            </div>
          </Field>
          {patientError && <Alert message={patientError} />}
          <p className="text-slate-600 text-xs">
            O CPF é usado para localizar o paciente e vincular o exame ao agendamento correto.
          </p>
        </div>
      )}

      {step >= 2 && patient && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-xl border border-emerald-700/40 bg-emerald-900/10">
            <UserCheck size={20} className="text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-slate-100 font-semibold truncate">{patient.name}</p>
              <p className="text-slate-400 text-xs">
                Nasc.: {maskBirthDate(patient.birth_date)} &nbsp;|&nbsp; Prontuário: {patient.medical_record_number}
              </p>
            </div>
            {step === 2 && (
              <button className="btn-ghost text-xs px-2 py-1 shrink-0" onClick={() => { setStep(1); setPatient(null); setCpfSearch(''); setCpfInput(''); }}>
                Trocar
              </button>
            )}
          </div>

          {step === 2 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-navy-700 flex items-center gap-2">
                <Calendar size={14} className="text-cyan-400" />
                <span className="text-sm font-medium text-slate-300">Agendamentos do paciente — selecione o exame</span>
              </div>
              {loadingAppts ? (
                <div className="flex items-center justify-center py-10"><Spinner size={20} /></div>
              ) : !appointmentsData?.length ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <AlertCircle size={24} className="text-amber-400" />
                  <p className="text-slate-400 text-sm text-center max-w-xs">
                    Nenhum agendamento ativo para este paciente.<br />
                    <span className="text-slate-500 text-xs">Use o atendimento avulso abaixo ou crie um agendamento na agenda.</span>
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-navy-800/60">
                  {appointmentsData.map((appt: any) => (
                    <button
                      key={appt.id}
                      className="w-full px-4 py-3 text-left hover:bg-navy-800/50 transition-colors flex items-center gap-4"
                      onClick={() => handleSelectAppt(appt)}
                    >
                      <div className="w-10 h-10 rounded-lg bg-navy-800 border border-navy-600 flex items-center justify-center shrink-0">
                        <span className="text-cyan-400 text-xs font-mono font-bold">
                          {appt.modality_type?.slice(0,2) ?? '??'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-slate-200 font-medium text-sm truncate">{appt.procedure_name}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${APPT_STATUS[appt.status]?.cls ?? 'text-slate-400 bg-navy-800 border-navy-600'}`}>
                            {APPT_STATUS[appt.status]?.label ?? appt.status}
                          </span>
                        </div>
                        <p className="text-slate-500 text-xs">
                          {formatDateTime(appt.scheduled_at)}
                          &nbsp;·&nbsp;
                          {modalityLabel[appt.modality_type] ?? appt.modality_type ?? '—'}
                          &nbsp;·&nbsp;
                          {appt.duration_minutes} min
                        </p>
                      </div>
                      <ChevronRight size={15} className="text-slate-600 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="card p-4 mt-4">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Atendimento avulso</p>
              <p className="text-xs text-slate-600 mb-3">Sem agendamento prévio? Registre o exame direto (entra com check-in nesta unidade).</p>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Field label="Procedimento">
                    <select className="input" value={walkInProc} onChange={e => setWalkInProc(e.target.value)}>
                      <option value="">— Selecione —</option>
                      {(procList as any[]).map(p => (
                        <option key={p.id} value={p.id}>{p.name}{p.modality_type ? ` · ${p.modality_type}` : ''}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <button
                  className="btn-primary shrink-0"
                  disabled={!walkInProc || walkInMut.isPending}
                  onClick={() => walkInMut.mutate()}
                >
                  {walkInMut.isPending ? <Spinner size={14} /> : <><Plus size={14} /> Registrar avulso</>}
                </button>
              </div>
              {walkInMut.isError && (
                <p className="text-xs text-red-400 mt-2">{(walkInMut.error as any)?.response?.data?.message ?? 'Falha ao registrar atendimento avulso'}</p>
              )}
            </div>
          )}
        </div>
      )}

      {step === 3 && selectedAppt && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-xl border border-cyan-700/40 bg-cyan-900/10">
            <Calendar size={18} className="text-cyan-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-slate-100 font-semibold text-sm truncate">{selectedAppt.procedure_name}</p>
              <p className="text-slate-400 text-xs">
                {formatDateTime(selectedAppt.scheduled_at)} &nbsp;·&nbsp; {patient.name}
              </p>
            </div>
            <button className="btn-ghost text-xs px-2 py-1 shrink-0" onClick={() => { setStep(2); setSelectedAppt(null); setFiles([]); uploadMut.reset(); }}>
              Trocar
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              {uploadMut.isPending ? (
                <div className="card p-8 flex flex-col items-center gap-4">
                  <Loader2 size={28} className="animate-spin text-cyan-400" />
                  <p className="text-slate-300 font-medium">Enviando arquivos…</p>
                  <div className="w-full max-w-sm">
                    <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                      <span>{uploadPct}%</span>
                      <span className="font-mono">{files.length} arq · {fmtBytes(totalBytes)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-navy-800 overflow-hidden">
                      <div
                        className="h-full transition-all duration-200"
                        style={{ width: `${uploadPct}%`, background: 'linear-gradient(90deg, var(--cyan-500), var(--cyan-400))' }}
                      />
                    </div>
                  </div>
                  <p className="text-slate-500 text-xs text-center">
                    {uploadPct < 100
                      ? 'Não feche esta janela durante o envio.'
                      : 'Upload concluído. Indexando no PACS…'}
                  </p>
                </div>
              ) : (
                <div
                  onDragOver={e => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center gap-4 p-10 rounded-xl
                    cursor-pointer transition-all duration-200 border-2 border-dashed
                    ${drag
                      ? 'border-cyan-400 bg-cyan-400/10 scale-[1.01]'
                      : 'border-navy-600 bg-navy-900/40 hover:border-navy-500 hover:bg-navy-800/40'
                    }`}
                >
                  <input ref={fileInputRef} type="file" multiple accept=".dcm,application/dicom" className="hidden" onChange={onFileInput} />
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${drag ? 'bg-cyan-400/20' : 'bg-navy-800'}`}>
                    <Upload size={24} className={drag ? 'text-cyan-400' : 'text-slate-500'} />
                  </div>
                  <div className="text-center">
                    <p className="text-slate-300 font-medium">{drag ? 'Solte os arquivos aqui' : 'Arraste arquivos .dcm aqui'}</p>
                    <p className="text-slate-500 text-sm mt-1">ou clique para selecionar</p>
                    <p className="text-slate-600 text-xs mt-2">Apenas arquivos DICOM (.dcm)</p>
                  </div>
                </div>
              )}

              {uploadMut.isError && (() => {
                const err  = uploadMut.error as any;
                const sts  = err?.response?.status;
                const code = err?.code;
                const msg  = err?.response?.data?.message;
                let humanMessage: string;
                if (sts === 413)         humanMessage = `Upload excede o limite do servidor. Tamanho total: ${fmtBytes(totalBytes)}. O limite atual é 5 GB. Reduza o número de arquivos ou contate o suporte.`;
                else if (sts === 408 || code === 'ECONNABORTED') humanMessage = `Tempo esgotado durante o upload. Tente novamente — uploads grandes (${fmtBytes(totalBytes)}) podem demorar minutos em rede lenta.`;
                else if (code === 'ERR_NETWORK')                  humanMessage = 'Falha de rede durante o envio. Verifique sua conexão e tente de novo.';
                else if (msg)            humanMessage = msg;
                else                     humanMessage = 'Erro ao enviar arquivos. Verifique se o Orthanc está rodando.';

                return (
                  <div className="rounded-lg border border-red-800/60 bg-red-950/60 p-3 text-sm text-red-300 animate-fade-in">
                    <p className="font-semibold mb-1">Falha no upload</p>
                    <p className="text-xs leading-relaxed">{humanMessage}</p>
                    {sts && <p className="text-[10px] font-mono text-red-500 mt-1">HTTP {sts}{code ? ` · ${code}` : ''}</p>}
                    <button className="mt-2 text-xs text-red-400 hover:text-red-200" onClick={() => uploadMut.reset()}>
                      Fechar
                    </button>
                  </div>
                );
              })()}
            </div>

            <div className="space-y-3">
              {files.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-navy-700">
                    <span className="text-sm font-medium text-slate-300">
                      {files.length} arquivo{files.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">{formatBytes(totalSize)}</span>
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 px-4 py-2 border-b border-navy-800/40 text-sm">
                        <FileImage size={12} className="text-cyan-500 shrink-0" />
                        <span className="flex-1 truncate text-slate-300 text-xs">{f.name}</span>
                        <span className="text-slate-600 font-mono text-xs shrink-0">{formatBytes(f.size)}</span>
                        <button onClick={() => setFiles(p => p.filter((_,j) => j !== i))} className="text-slate-600 hover:text-red-400 transition-colors">
                          <XCircle size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Contexto da realização</p>
                    <p className="text-xs text-slate-600 mt-0.5">Onde o exame foi feito · auto-preenchido pela sua lotação</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowContextDetails(s => !s)}
                    className="text-xs text-cyan-400 hover:text-cyan-300"
                  >
                    {showContextDetails ? 'Recolher' : 'Editar'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 uppercase tracking-wide">Unidade</span>
                    <p className="text-slate-200 font-medium mt-0.5">
                      {myUnit?.name ?? (currentUser?.role === 'admin' ? 'Sem lotação (admin)' : '—')}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase tracking-wide">Técnico responsável</span>
                    <p className="text-slate-200 font-medium mt-0.5">{currentUser?.name ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase tracking-wide">Equipamento</span>
                    <p className="text-slate-200 font-medium mt-0.5">
                      {modalitiesList.find((m: any) => m.id === equipmentId)?.name
                        ?? (selectedAppt?.modality_name ?? 'a definir')}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 uppercase tracking-wide">Sala</span>
                    <p className="text-slate-200 font-medium mt-0.5">
                      {roomsList.find((r: any) => r.id === roomId)?.name
                        ?? (selectedAppt?.room_name ?? 'a definir')}
                    </p>
                  </div>
                </div>

                {showContextDetails && (
                  <div className="space-y-3 pt-3 border-t border-navy-800/40">
                    <Field label="Equipamento usado">
                      <select className="input" value={equipmentId} onChange={e => setEquipmentId(e.target.value)}>
                        <option value="">— Herdar do agendamento —</option>
                        {modalitiesList.map((m: any) => (
                          <option key={m.id} value={m.id}>{m.name} ({m.dicom_ae_title})</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Sala">
                      <select className="input" value={roomId} onChange={e => setRoomId(e.target.value)}>
                        <option value="">— Herdar do agendamento —</option>
                        {roomsList.map((r: any) => (
                          <option key={r.id} value={r.id}>{r.name}{r.modality_name ? ` · ${r.modality_name}` : ''}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                )}
              </div>

              <div className="card p-4 space-y-3">
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Detalhes da realização</p>
                  <p className="text-xs text-slate-600 mt-0.5">Como o exame foi efetivamente realizado</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Data e hora da realização">
                    <input
                      className="input"
                      type="datetime-local"
                      value={performedAt}
                      onChange={e => setPerformedAt(e.target.value)}
                    />
                    <p className="text-xs text-slate-600 mt-0.5">Em branco = agora / extraído do DICOM</p>
                  </Field>
                  <Field label="Qualidade do exame">
                    <select className="input" value={examQuality} onChange={e => setExamQuality(e.target.value)}>
                      <option value="">— Não avaliada —</option>
                      <option value="adequate">Adequado</option>
                      <option value="limited">Limitado (com ressalvas)</option>
                      <option value="repeat">Necessita repetição</option>
                    </select>
                  </Field>
                </div>
                <Field label="Médico executor / responsável">
                  <input
                    className="input"
                    placeholder="Ex: Dr. Fulano de Tal (opcional)"
                    value={performingPhysician}
                    onChange={e => setPerformingPhysician(e.target.value)}
                  />
                </Field>
                <Field label="Complicações / intercorrências">
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="Ex: contraste injetado sem reações; paciente não colaborou; série repetida por movimento…"
                    value={complications}
                    onChange={e => setComplications(e.target.value)}
                  />
                </Field>
              </div>

              <div className="flex gap-3">
                <button className="btn-ghost flex-1 justify-center" onClick={reset}>
                  <RefreshCw size={14} /> Reiniciar
                </button>
                <button
                  className="btn-primary flex-1 justify-center"
                  onClick={() => uploadMut.mutate()}
                  disabled={!files.length || uploadMut.isPending}
                >
                  {uploadMut.isPending
                    ? <><Spinner size={14} /> Enviando...</>
                    : <><Upload size={14} /> Enviar {files.length} arquivo{files.length !== 1 ? 's' : ''}</>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
