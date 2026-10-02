export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR').format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit',
  }).format(new Date(iso));
}

export function formatAge(birthDate: string | null | undefined): string {
  if (!birthDate) return '—';
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return `${age} anos`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatCurrency(value: number | string | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(n);
}

export const appointmentStatusLabel: Record<string, string> = {
  scheduled:'Agendado', confirmed:'Confirmado', checked_in:'Chegou',
  in_progress:'Em andamento', done:'Realizado', cancelled:'Cancelado', no_show:'Faltou',
};

export const appointmentStatusBadge: Record<string, string> = {
  scheduled:'badge-info', confirmed:'badge-cyan', checked_in:'badge-warning',
  in_progress:'badge-warning', done:'badge-success', cancelled:'badge-danger', no_show:'badge-danger',
};

export const reportStatusLabel: Record<string, string> = {
  draft:'Rascunho', review:'Em revisão', signed:'Assinado', amended:'Emendado', cancelled:'Cancelado',
};

export const reportStatusBadge: Record<string, string> = {
  draft:'badge-neutral', review:'badge-warning', signed:'badge-success', amended:'badge-info', cancelled:'badge-danger',
};

export const studyStatusLabel: Record<string, string> = {
  pending:'Aguardando', receiving:'Recebendo', received:'Recebido',
  incomplete:'Incompleto', complete:'Completo', archived:'Arquivado', deleted:'Removido',
};

export const genderLabel: Record<string, string> = { M:'Masculino', F:'Feminino', O:'Outro' };

export const modalityLabel: Record<string, string> = {
  CT:'Tomografia', MR:'Ressonância', DX:'Raio-X Digital', CR:'Radiografia',
  US:'Ultrassom', NM:'Med. Nuclear', PT:'PET-CT', MG:'Mamografia', RF:'Fluoroscopia',
  XA:'Angiografia', SC:'Captura Secundária', OT:'Outro',
};

export function priorityLabel(p: number): string {
  return ['Normal','Urgente','Emergência'][p] ?? 'Normal';
}

export function priorityBadge(p: number): string {
  return ['badge-neutral','badge-warning','badge-danger'][p] ?? 'badge-neutral';
}

export function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as any;
    return e.response?.data?.message ?? e.message ?? 'Erro inesperado';
  }
  if (err instanceof Error) return err.message;
  return 'Erro inesperado';
}
