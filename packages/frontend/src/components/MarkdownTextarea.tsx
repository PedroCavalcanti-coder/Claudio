import { forwardRef, useImperativeHandle, useRef } from 'react';

// Ao contrário de toolbars "fake" que só inserem o literal "**texto**", aqui os marcadores
// respeitam a seleção atual do cursor (envolvem, ou ficam entre eles se nada selecionado).
export interface MarkdownTextareaHandle {
  insertAtCursor: (text: string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  /** Mostra o toolbar acima do textarea. Padrão: true. */
  toolbar?: boolean;
  /** ID estável usado para identificar qual textarea está focado (auto-texto). */
  id?: string;
  onFocus?: () => void;
}

type FormatAction =
  | { mode: 'wrap';   left: string; right: string; placeholder: string }
  | { mode: 'prefix'; prefix: string }
  | { mode: 'block';  text: string };

const ACTIONS: { label: string; title: string; action: FormatAction; fontWeight?: number; fontStyle?: string }[] = [
  { label:'B',  title:'Negrito — envolve a seleção (Ctrl+B)',          action:{ mode:'wrap',   left:'**', right:'**', placeholder:'texto' }, fontWeight:700 },
  { label:'I',  title:'Itálico — envolve a seleção (Ctrl+I)',          action:{ mode:'wrap',   left:'_',  right:'_',  placeholder:'texto' }, fontStyle:'italic' },
  { label:'•',  title:'Lista — prefixa cada linha selecionada com "- "', action:{ mode:'prefix', prefix:'- ' } },
  { label:'1.', title:'Lista numerada — prefixa com "1. "',             action:{ mode:'prefix', prefix:'1. ' } },
  { label:'H',  title:'Título — prefixa a linha com "## "',              action:{ mode:'prefix', prefix:'## ' } },
];

export const MarkdownTextarea = forwardRef<MarkdownTextareaHandle, Props>(function MarkdownTextarea(
  { value, onChange, placeholder, rows = 4, toolbar = true, id, onFocus },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  const applyFormat = (action: FormatAction) => {
    const ta = taRef.current; if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const sel   = value.slice(start, end);

    let next = value;
    let caretStart = start;
    let caretEnd   = end;

    if (action.mode === 'wrap') {
      const { left, right, placeholder } = action;
      if (sel) {
        next = value.slice(0, start) + left + sel + right + value.slice(end);
        caretStart = start + left.length;
        caretEnd   = caretStart + sel.length;
      } else {
        next = value.slice(0, start) + left + placeholder + right + value.slice(end);
        caretStart = start + left.length;
        caretEnd   = caretStart + placeholder.length;
      }
    } else if (action.mode === 'prefix') {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineEnd   = end > start ? end : (value.indexOf('\n', start) === -1 ? value.length : value.indexOf('\n', start));
      const block     = value.slice(lineStart, lineEnd);
      const prefixed  = block.split('\n').map(l => l.length ? action.prefix + l : l).join('\n');
      next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
      caretStart = lineStart + action.prefix.length;
      caretEnd   = caretStart + (prefixed.length - block.length - action.prefix.length + block.length);
    } else {
      const needsLeadingBreak = start > 0 && value[start - 1] !== '\n';
      const insertion = (needsLeadingBreak ? '\n' : '') + action.text;
      next = value.slice(0, start) + insertion + value.slice(end);
      caretStart = start + insertion.length;
      caretEnd   = caretStart;
    }

    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caretStart, caretEnd);
    });
  };

  useImperativeHandle(ref, () => ({
    insertAtCursor(text: string) {
      const ta = taRef.current; if (!ta) return;
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      const next  = value.slice(0, start) + text + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + text.length, start + text.length);
      });
    },
    focus() { taRef.current?.focus(); },
  }), [value, onChange]);

  return (
    <div>
      {toolbar && (
        <div style={{
          display:'flex', alignItems:'center', gap:4,
          padding:'4px 6px', background:'var(--bg-overlay)',
          border:'1px solid var(--border-d)', borderBottom:'none',
          borderRadius:'var(--r-md) var(--r-md) 0 0',
        }}>
          {ACTIONS.map(({ label, title, action, fontWeight, fontStyle }) => (
            <button
              key={label}
              type="button"
              title={title}
              onClick={() => applyFormat(action)}
              style={{
                minWidth:22, height:22, padding:'0 6px',
                borderRadius:'var(--r-xs)', fontSize:11,
                background:'transparent', border:'1px solid transparent',
                color:'var(--text-m)', cursor:'pointer',
                fontWeight, fontStyle,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-panel)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {label}
            </button>
          ))}
          <div style={{ flex:1 }}/>
          <span style={{ fontSize:9, color:'var(--text-d)' }}>Markdown</span>
        </div>
      )}
      <textarea
        ref={taRef}
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        rows={rows}
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
            const key = e.key.toLowerCase();
            if (key === 'b') { e.preventDefault(); applyFormat({ mode:'wrap', left:'**', right:'**', placeholder:'texto' }); }
            else if (key === 'i') { e.preventDefault(); applyFormat({ mode:'wrap', left:'_', right:'_', placeholder:'texto' }); }
          }
        }}
        style={{
          width:'100%', resize:'vertical', padding:'7px 9px', fontSize:12, lineHeight:1.65,
          borderRadius: toolbar ? '0 0 var(--r-md) var(--r-md)' : 'var(--r-md)',
          background:'var(--bg-overlay)',
          border:'1px solid var(--border-d)',
          borderTop: toolbar ? '1px solid var(--border-s)' : '1px solid var(--border-d)',
          color:'var(--text-p)', outline:'none', fontFamily:'var(--font-m)',
        }}
      />
    </div>
  );
});
