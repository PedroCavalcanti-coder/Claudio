// Exigência LGPD: o formulário chamador deve bloquear o envio enquanto `checked` for false.
export default function TermsCheckbox({
  checked, onChange, label = 'Li e concordo com os',
}: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-start gap-2 text-xs text-slate-400 cursor-pointer select-none">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}{' '}
        <a href="/termos" target="_blank" rel="noreferrer" className="text-cyan-400 underline hover:text-cyan-300">
          Termos de Uso e a Política de Privacidade
        </a>.
      </span>
    </label>
  );
}
