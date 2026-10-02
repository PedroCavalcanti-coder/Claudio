import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Download, Ban } from 'lucide-react';
import { patientsApi, consentApi } from '../api/endpoints';
import { Modal, Spinner } from './ui';
import { toast } from './ui/Toast';
import type { Patient } from '../types';

// Painel de direitos do titular exigido pela LGPD (exportação, log de acessos, revogação de consentimento).
export default function LgpdModal({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const [tab, setTab] = useState<'export' | 'access'>('export');
  const [downloading, setDownloading] = useState(false);

  const { data: exportData, isLoading: loadingExport, refetch: refetchExport } = useQuery({
    queryKey: ['lgpd-export', patient.id],
    queryFn:  () => patientsApi.lgpdExport(patient.id).then(r => (r.data as any).data),
  });
  const { data: accessLog = [], isLoading: loadingAccess } = useQuery({
    queryKey: ['lgpd-access', patient.id],
    queryFn:  () => patientsApi.accessLog(patient.id).then(r => (r.data as any).data),
    enabled:  tab === 'access',
  });

  const revokeMut = useMutation({
    mutationFn: (consentId: string) => consentApi.revoke(consentId),
    onSuccess: () => { toast.success('Consentimento revogado'); refetchExport(); },
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Falha ao revogar'),
  });

  const downloadJson = async () => {
    setDownloading(true);
    try {
      const data = exportData ?? (await patientsApi.lgpdExport(patient.id).then(r => (r.data as any).data));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `lgpd_${patient.medical_record_number || patient.id}.json`; a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  };

  return (
    <Modal open onClose={onClose} title="LGPD — Direitos do titular" size="lg">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">{patient.name} · Pront. {patient.medical_record_number}</p>

        <div className="flex border-b border-navy-700">
          {([['export','Dados & consentimentos'],['access','Relatório de acessos']] as const).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
                tab === t ? 'border-cyan-500 text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
              {l}
            </button>
          ))}
        </div>

        {tab === 'export' ? (
          <div className="space-y-3">
            <button className="btn-primary" onClick={downloadJson} disabled={downloading || loadingExport}>
              {downloading ? <Spinner size={14}/> : <><Download size={14}/> Baixar exportação (JSON)</>}
            </button>
            {loadingExport ? <Spinner size={16}/> : exportData && (
              <div className="text-xs text-slate-400 space-y-2">
                <div>Agendamentos: <strong className="text-slate-200">{exportData.appointments?.length ?? 0}</strong> · Estudos: <strong className="text-slate-200">{exportData.studies?.length ?? 0}</strong> · Laudos: <strong className="text-slate-200">{exportData.reports?.length ?? 0}</strong></div>
                <div className="font-semibold text-slate-200 mt-2">Consentimentos</div>
                {(!exportData.consents || !exportData.consents.length) ? (
                  <div className="text-slate-500">Nenhum consentimento registrado.</div>
                ) : exportData.consents.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-navy-700">
                    <div>
                      <div className="text-slate-200">{c.title}</div>
                      <div className="text-[10px] text-slate-500">
                        {c.revoked_at ? `Revogado em ${new Date(c.revoked_at).toLocaleDateString('pt-BR')}`
                                      : `Assinado em ${c.signed_at ? new Date(c.signed_at).toLocaleDateString('pt-BR') : '—'}`}
                      </div>
                    </div>
                    {!c.revoked_at && (
                      <button className="btn-ghost px-2 py-1 text-xs" disabled={revokeMut.isPending}
                        onClick={() => revokeMut.mutate(c.id)}>
                        <Ban size={12}/> Revogar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          loadingAccess ? <Spinner size={16}/> : !accessLog.length ? (
            <div className="text-xs text-slate-500 text-center py-4">Nenhum acesso registrado.</div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="text-slate-500 text-left">
                  <th className="px-1.5 py-1">Quando</th><th>Usuário</th><th>Ação</th><th>Recurso</th>
                </tr></thead>
                <tbody>
                  {accessLog.map((a: any) => (
                    <tr key={a.id} className="border-t border-navy-800/60 text-slate-400">
                      <td className="px-1.5 py-1 font-mono whitespace-nowrap">{new Date(a.created_at).toLocaleString('pt-BR')}</td>
                      <td>{a.user_email ?? '—'}</td>
                      <td>{a.action}</td>
                      <td>{a.resource_type ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
