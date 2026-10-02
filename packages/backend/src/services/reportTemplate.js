'use strict';
/**
 * Template canônico do laudo (server-side).
 * --------------------------------------------------------------------
 * Fonte ÚNICA de verdade para o HTML do laudo assinado. Antes, havia dois
 * geradores divergentes — um no controller (download) e outro no cliente
 * (ReportModal.buildHtml) — o que produzia formatação inconsistente entre
 * preview, PDF assinado e impressão.
 *
 * Agora o documento legal é renderizado 100% no servidor a partir dos campos
 * ESTRUTURADOS do laudo (findings/conclusion/...) + dados de paciente, estudo,
 * unidade e radiologista. O mesmo HTML é:
 *   - hasheado (SHA-256) para a assinatura digital;
 *   - convertido em PDF (Puppeteer) e arquivado no RustFS;
 *   - devolvido em /download (reprodução fiel do que foi assinado).
 *
 * Os campos clínicos suportam Markdown leve (negrito/itálico/listas/título),
 * coerente com o editor MarkdownTextarea do frontend.
 */

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Conversor Markdown→HTML mínimo e seguro (escapa antes de aplicar marcadores).
 * Suporta: ## título, **negrito**, _itálico_, - lista, 1. lista numerada,
 * --- separador e quebras de linha.
 */
function renderMarkdown(src) {
  if (!src || !src.trim()) return '';
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let listType = null; // 'ul' | 'ol' | null

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

  const inline = (text) => {
    let s = escapeHtml(text);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
    return s;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }

    if (/^---+$/.test(line.trim())) { closeList(); out.push('<hr/>'); continue; }

    let m;
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) { closeList(); out.push(`<h4>${inline(m[1])}</h4>`); continue; }
    if ((m = line.match(/^\s*-\s+(.*)$/)))   { if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}
function genderLabel(g) {
  return g === 'M' ? 'Masculino' : g === 'F' ? 'Feminino' : (g ? 'Outro' : '—');
}

/**
 * Monta o corpo clínico (seções) a partir dos campos estruturados.
 * Renderiza só as seções preenchidas, em ordem clínica.
 */
function buildSections(s = {}) {
  const section = (title, content) => {
    const html = renderMarkdown(content);
    return html ? `<div class="section"><h3>${escapeHtml(title)}</h3>${html}</div>` : '';
  };
  return [
    section('Indicação Clínica', s.indication),
    section('Técnica',           s.technique),
    section('Achados',           s.findings),
    section('Impressão Diagnóstica', s.conclusion),
    section('Conduta / Recomendações', s.recommendations),
  ].filter(Boolean).join('\n') || '<p class="empty">Sem conteúdo clínico registrado.</p>';
}

/**
 * Gera o documento HTML completo do laudo.
 *
 * @param {Object} data
 * @param {Object} data.patient      { name, birth_date, gender, medical_record_number }
 * @param {Object} data.study        { study_date, modality_type, accession_number }
 * @param {Object} data.unit         { name, cnes, phone, email }
 * @param {Object} data.radiologist  { name, crm, crm_uf, specialty }
 * @param {Object} data.sections     { indication, technique, findings, conclusion, recommendations }
 * @param {Object} data.signature    { hash, signed_at }
 * @param {boolean} data.forPrint    inclui a barra "Imprimir" (não vai pro PDF)
 */
function buildReportHtml(data = {}) {
  const patient     = data.patient     || {};
  const study       = data.study       || {};
  const unit        = data.unit        || {};
  const radiologist = data.radiologist || {};
  const signature   = data.signature   || {};
  const e = escapeHtml;

  const unitName = e(unit.name) || 'RIS/PACS — Rede Municipal de Saúde';
  const unitSub  = [
    unit.cnes  ? `CNES ${e(unit.cnes)}`   : '',
    unit.phone ? e(unit.phone)            : '',
    unit.email ? e(unit.email)            : '',
  ].filter(Boolean).join(' · ');

  const printBar = data.forPrint ? `
<div class="no-print" style="background:#1a3a5c;color:#fff;padding:10px 20px;text-align:center;font-family:sans-serif;font-size:11pt;">
  <strong>Laudo Médico</strong> &nbsp;|&nbsp;
  <a href="javascript:window.print()" style="color:#7ecfff;font-weight:bold;">Imprimir / Salvar como PDF</a>
</div>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Laudo de Imagem</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', serif; font-size: 12pt; color: #111; background: #fff; }
  .page { max-width: 210mm; margin: 0 auto; padding: 20mm 20mm 15mm; }
  .header { border-bottom: 2px solid #1a3a5c; padding-bottom: 10px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
  .clinic-name { font-size: 18pt; font-weight: bold; color: #1a3a5c; }
  .clinic-sub  { font-size: 9pt; color: #555; margin-top: 3px; }
  .report-title { font-size: 14pt; font-weight: bold; text-align: center; margin: 14px 0 10px; color: #1a3a5c; text-transform: uppercase; letter-spacing: 1px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; border: 1px solid #ccc; padding: 10px 14px; border-radius: 4px; margin-bottom: 16px; font-size: 10.5pt; }
  .info-row { display: flex; gap: 4px; }
  .info-label { font-weight: bold; color: #333; white-space: nowrap; }
  .info-val   { color: #111; }
  .section { margin-bottom: 14px; }
  .section h3 { font-size: 11pt; font-weight: bold; color: #1a3a5c; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  .section h4 { font-size: 11pt; font-weight: bold; margin: 6px 0 4px; }
  .section p { font-size: 11pt; line-height: 1.6; text-align: justify; margin-bottom: 6px; }
  .section ul, .section ol { margin: 4px 0 8px 22px; }
  .section li { font-size: 11pt; line-height: 1.55; }
  .section hr { border: none; border-top: 1px solid #ddd; margin: 8px 0; }
  .section .empty { color: #999; font-style: italic; }
  .signature-box { margin-top: 28px; border-top: 2px solid #1a3a5c; padding-top: 12px; display: flex; justify-content: flex-end; }
  .signature-content { text-align: center; min-width: 220px; }
  .signature-name { font-size: 12pt; font-weight: bold; }
  .signature-crm  { font-size: 10pt; color: #444; }
  .signature-date { font-size: 9pt; color: #666; margin-top: 4px; }
  .hash-box { margin-top: 18px; border: 1px dashed #aaa; padding: 6px 10px; font-size: 7.5pt; color: #888; font-family: monospace; word-break: break-all; }
  .footer { margin-top: 20px; border-top: 1px solid #ddd; padding-top: 8px; font-size: 8pt; color: #888; text-align: center; }
  @media print {
    body { margin: 0; }
    .page { padding: 10mm 15mm; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
${printBar}
<div class="page">
  <div class="header">
    <div>
      <div class="clinic-name">${unitName}</div>
      ${unitSub ? `<div class="clinic-sub">${unitSub}</div>` : ''}
      <div class="clinic-sub" style="margin-top:2px;">Laudo de Exame de Imagem</div>
    </div>
    <div style="text-align:right;font-size:9pt;color:#555;">
      Nº Acesso: <strong>${e(study.accession_number) || '—'}</strong><br>
      Data do estudo: <strong>${fmtDate(study.study_date)}</strong>
    </div>
  </div>

  <div class="report-title">Laudo de Imagem — ${e(study.modality_type) || 'Diagnóstico por Imagem'}</div>

  <div class="info-grid">
    <div class="info-row"><span class="info-label">Paciente:</span><span class="info-val">${e(patient.name)}</span></div>
    <div class="info-row"><span class="info-label">Modalidade:</span><span class="info-val">${e(study.modality_type) || '—'}</span></div>
    <div class="info-row"><span class="info-label">Data nasc.:</span><span class="info-val">${fmtDate(patient.birth_date)}</span></div>
    <div class="info-row"><span class="info-label">Prontuário:</span><span class="info-val">${e(patient.medical_record_number)}</span></div>
    <div class="info-row"><span class="info-label">Sexo:</span><span class="info-val">${genderLabel(patient.gender)}</span></div>
    <div class="info-row"><span class="info-label">Data laudo:</span><span class="info-val">${fmtDateTime(signature.signed_at)}</span></div>
  </div>

  ${buildSections(data.sections)}

  ${Array.isArray(data.cid10) && data.cid10.length ? `
  <div class="section">
    <h3>Diagnóstico (CID-10)</h3>
    <ul>
      ${data.cid10.map(c => `<li><strong>${escapeHtml(c.code)}</strong> — ${escapeHtml(c.description)}</li>`).join('')}
    </ul>
  </div>` : ''}

  <div class="signature-box">
    <div class="signature-content">
      <div style="border-top:1px solid #222;width:200px;margin:0 auto 6px;"></div>
      <div class="signature-name">${e(radiologist.name)}</div>
      <div class="signature-crm">CRM: ${e(radiologist.crm)}${radiologist.crm_uf ? '/' + e(radiologist.crm_uf) : ''}${radiologist.specialty ? ' — ' + e(radiologist.specialty) : ''}</div>
      <div class="signature-date">Assinado digitalmente em ${fmtDateTime(signature.signed_at)}</div>
    </div>
  </div>

  ${signature.hash ? `<div class="hash-box">Hash de integridade (SHA-256): ${e(signature.hash)}</div>` : ''}

  <div class="footer">
    Documento gerado eletronicamente • Verificação de autenticidade disponível no portal do sistema
  </div>
</div>
</body>
</html>`;
}

module.exports = { buildReportHtml, renderMarkdown };
