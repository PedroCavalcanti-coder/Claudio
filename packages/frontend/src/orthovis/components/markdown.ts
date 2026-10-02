// Escapa o texto antes de qualquer processamento para evitar injeção de HTML/XSS no preview de notas
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdown(text: string): string {
  if (!text.trim()) return '<p class="md-empty">Sem conteúdo</p>';

  const safe = escapeHtml(text);
  const lines = safe.split('\n');
  const out: string[] = [];
  let inUl = false, inOl = false;

  const flushLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^---+$/.test(line)) { flushLists(); out.push('<hr class="md-hr"/>'); continue; }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      flushLists();
      const lvl = h[1].length;
      out.push(`<h${lvl} class="md-h md-h${lvl}">${inline(h[2])}</h${lvl}>`);
      continue;
    }
    if (/^&gt;\s+/.test(line)) {
      flushLists();
      out.push(`<blockquote class="md-q">${inline(line.replace(/^&gt;\s+/, ''))}</blockquote>`);
      continue;
    }
    const ol = /^(\d+)\.\s+(.+)$/.exec(line);
    if (ol) {
      if (!inOl) { flushLists(); out.push('<ol class="md-ol">'); inOl = true; }
      out.push(`<li>${inline(ol[2])}</li>`);
      continue;
    }
    const ul = /^[-•*]\s+(.+)$/.exec(line);
    if (ul) {
      if (!inUl) { flushLists(); out.push('<ul class="md-ul">'); inUl = true; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    if (!line.trim()) { flushLists(); out.push('<div class="md-br"></div>'); continue; }
    flushLists();
    out.push(`<p class="md-p">${inline(line)}</p>`);
  }
  flushLists();
  return out.join('');
}

function inline(s: string): string {
  let r = s.replace(/`([^`\n]+?)`/g, '<code class="md-code">$1</code>');
  // Restrito a http(s) para não permitir esquemas como javascript: nos links
  r = r.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  r = r.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  r = r.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  // \b evita interpretar underscore dentro de identificadores como itálico
  r = r.replace(/\b_([^_\n]+?)_\b/g, '<em>$1</em>');
  return r;
}
