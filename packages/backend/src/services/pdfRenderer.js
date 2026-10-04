'use strict';

/**
 * Renderizador de PDF server-side usando Puppeteer + Chromium headless.
 *
 * Singleton de browser — instanciado lazy na primeira chamada, reusado
 * entre requisições para evitar o custo de subir um Chromium por laudo.
 */

const logger = require('../config/logger');

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) return browserPromise;

  // puppeteer ≥ 25 é só-ESM: import() dinâmico funciona a partir do CommonJS
  const puppeteer = (await import('puppeteer')).default;
  // No container Docker (linux/glibc) usamos Chromium do sistema quando disponível
  // para evitar baixar 250MB no build. O Dockerfile instala o binário via apt.
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

  browserPromise = puppeteer.launch({
    headless: true,
    executablePath: execPath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=medium',
    ],
  }).catch(err => {
    logger.error('[pdf] falha ao iniciar Chromium', { message: err.message });
    browserPromise = null;
    throw err;
  });

  logger.info('[pdf] Chromium iniciado');
  return browserPromise;
}

/**
 * Renderiza um HTML como PDF (Buffer).
 *
 * @param {string} html — documento HTML completo, com CSS inline. O renderer
 *   NÃO aplica estilos extras; o caller é responsável pela formatação.
 * @param {object} [opts]
 * @param {string} [opts.format='A4']
 * @param {object} [opts.margin] — { top, right, bottom, left }
 * @returns {Promise<Buffer>}
 */
async function renderHtmlToPdf(html, opts = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // setContent é mais confiável do que goto('data:...') pra HTML grande
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });
    return await page.pdf({
      format:        opts.format ?? 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: opts.margin ?? { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
      displayHeaderFooter: false,
    });
  } finally {
    await page.close().catch(() => {});
  }
}

async function shutdown() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch {}
  browserPromise = null;
}

module.exports = { renderHtmlToPdf, shutdown };
