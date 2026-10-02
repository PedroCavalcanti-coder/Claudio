import { Field } from './ui';

/** Como a recepção confirmou a identidade do paciente no check-in. */
export type CheckinIdentity = {
  method: 'cpf' | 'cns' | 'document';
  value:  string;       // CPF ou CNS digitado
  documentChecked: boolean;
};

export const emptyIdentity: CheckinIdentity = { method: 'cpf', value: '', documentChecked: false };

export const identityValid = (i: CheckinIdentity) =>
  i.method === 'document' ? i.documentChecked : i.value.replace(/\D/g, '').length >= (i.method === 'cpf' ? 11 : 15);

/** Corpo do PATCH /appointments/:id/checkin (sem senha — o portal é opcional e tem fluxo próprio). */
export const identityBody = (i: CheckinIdentity) =>
  i.method === 'cpf'      ? { identity_verified_by: 'cpf' as const, cpf: i.value.trim() }
  : i.method === 'cns'    ? { identity_verified_by: 'cns' as const, cns: i.value.replace(/\D/g, '') }
  :                         { identity_verified_by: 'document' as const, document_verified: true };

const OPTIONS: { id: CheckinIdentity['method']; label: string }[] = [
  { id: 'cpf', label: 'CPF' }, { id: 'cns', label: 'CNS (cartão SUS)' }, { id: 'document', label: 'Documento com foto' },
];

export default function IdentityPicker({ value, onChange }: { value: CheckinIdentity; onChange: (v: CheckinIdentity) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Confirme a identidade do paciente. O acesso ao portal é opcional e pode ser liberado depois, na tela de Pacientes.
      </p>
      <div className="flex gap-1 flex-wrap" role="radiogroup" aria-label="Forma de confirmação da identidade">
        {OPTIONS.map(o => (
          <button key={o.id} type="button" role="radio" aria-checked={value.method === o.id}
            className={value.method === o.id ? 'btn-primary px-3 py-1 text-xs' : 'btn-ghost px-3 py-1 text-xs'}
            onClick={() => onChange({ ...value, method: o.id })}>
            {o.label}
          </button>
        ))}
      </div>
      {value.method === 'document' ? (
        <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={value.documentChecked}
            onChange={e => onChange({ ...value, documentChecked: e.target.checked })} />
          Conferi um documento oficial com foto e os dados conferem com o cadastro.
        </label>
      ) : (
        <Field label={value.method === 'cpf' ? 'CPF do paciente' : 'CNS do paciente'} required>
          <input className="input" inputMode="numeric"
            placeholder={value.method === 'cpf' ? '000.000.000-00' : '000 0000 0000 0000'}
            value={value.value} onChange={e => onChange({ ...value, value: e.target.value })} />
        </Field>
      )}
    </div>
  );
}
