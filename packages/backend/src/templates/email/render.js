'use strict';

/**
 * Render minimalista de templates HTML/text para email.
 *
 *   {{var}}        — substituição com escape HTML
 *   {{{var}}}      — substituição RAW (use só para HTML pré-renderizado/confiável)
 *   {{#cond}}…{{/cond}} — bloco condicional (truthy)
 *
 * Sem dependências externas. Suficiente para os 7 templates dessa fase.
 * Se a complexidade crescer, trocar por Handlebars/Mustache real.
 */

const fs   = require('fs');
const path = require('path');

const TEMPLATES_DIR = __dirname;
const LAYOUT_PATH   = path.join(TEMPLATES_DIR, '_layout.html');

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

function resolvePath(obj, dotted) {
  return dotted.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function renderString(tpl, data) {
  // 1. Blocos condicionais {{#path}}...{{/path}}
  let out = tpl.replace(/\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, path, body) => {
    const val = resolvePath(data, path);
    return val ? renderString(body, data) : '';
  });

  // 2. Raw substitutions {{{path}}}
  out = out.replace(/\{\{\{([\w.]+)\}\}\}/g, (_, p) => {
    const v = resolvePath(data, p);
    return v == null ? '' : String(v);
  });

  // 3. Escaped substitutions {{path}}
  out = out.replace(/\{\{([\w.]+)\}\}/g, (_, p) => escapeHtml(resolvePath(data, p)));

  return out;
}

/**
 * Renderiza um template por nome (sem extensão), envelopando no _layout.html.
 * Retorna { subject, html, text }.
 */
function render(templateName, data) {
  const tplPath = path.join(TEMPLATES_DIR, `${templateName}.html`);
  if (!fs.existsSync(tplPath)) {
    throw new Error(`[email/render] template não encontrado: ${templateName}`);
  }

  // O template começa com bloco de "meta" no formato:
  //   <!--subject: Assunto com {{var}} -->
  //   <!--preheader: Preview text curto -->
  //   <body content>
  const raw = fs.readFileSync(tplPath, 'utf8');

  const subjectMatch   = raw.match(/<!--\s*subject:\s*([^>]+?)\s*-->/i);
  const preheaderMatch = raw.match(/<!--\s*preheader:\s*([^>]+?)\s*-->/i);
  const bodyOnly       = raw
    .replace(/<!--\s*subject:[^>]+?-->\s*/i,   '')
    .replace(/<!--\s*preheader:[^>]+?-->\s*/i, '');

  const subject   = renderString(subjectMatch   ? subjectMatch[1]   : 'RIS/PACS', data);
  const preheader = renderString(preheaderMatch ? preheaderMatch[1] : '',         data);
  const innerHtml = renderString(bodyOnly, data);

  const layoutRaw = fs.readFileSync(LAYOUT_PATH, 'utf8');
  const html = renderString(layoutRaw, {
    ...data,
    subject,
    preheader,
    inner_html: innerHtml,    // ← {{{inner_html}}} no _layout (raw)
  });

  // Plain text fallback — strip tags
  const text = innerHtml
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { subject, html, text };
}

module.exports = { render, renderString, escapeHtml };
