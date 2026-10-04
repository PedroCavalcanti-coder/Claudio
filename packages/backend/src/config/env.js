const path = require('path');
const { z } = require('zod');

// override: true garante que o .env sempre prevalece sobre variáveis
// de ambiente já definidas no processo (ex.: residuais de sessões Docker)
// Em teste (jest) o ambiente vem de tests/setup — um .env de dev não pode vazar
// para a suíte (apontaria para o banco de verdade).
if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config({
    path:     path.resolve(__dirname, '../../.env'),
    override: true,
  });
}

// z.coerce.boolean() usa Boolean(string) — logo "false" vira true.
// Este parser interpreta os valores textuais usuais de forma correta.
const boolFromString = (def) =>
  z.preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (v == null) return def;
    return ['true', '1', 'yes', 'on'].includes(String(v).trim().toLowerCase());
  }, z.boolean());

const envSchema = z.object({
  NODE_ENV:              z.enum(['development', 'production', 'test']).default('development'),
  PORT:                  z.coerce.number().default(3000),
  API_PREFIX:            z.string().default('/api/v1'),
  FRONTEND_URL:          z.string().url().default('http://localhost:5173'),

  DATABASE_URL:          z.string().min(1),
  DATABASE_POOL_MIN:     z.coerce.number().default(2),
  DATABASE_POOL_MAX:     z.coerce.number().default(20),
  DATABASE_SSL:          boolFromString(false),
  // Reaplica o schema (idempotente) a cada boot. Desligue só se a migração for feita à parte.
  AUTO_MIGRATE:          boolFromString(true),

  REDIS_URL:             z.string().default('redis://localhost:6379'),

  JWT_PRIVATE_KEY:       z.string().min(1),
  JWT_PUBLIC_KEY:        z.string().min(1),
  JWT_ACCESS_EXPIRES:    z.string().default('15m'),
  JWT_REFRESH_EXPIRES:   z.string().default('7d'),

  ENCRYPTION_KEY:        z.string().length(64),
  KEY_ENCRYPTION_KEY:    z.string().length(64),

  RUSTFS_ENDPOINT:        z.string().default('localhost'),
  RUSTFS_PORT:            z.coerce.number().default(9000),
  RUSTFS_USE_SSL:         boolFromString(false),
  RUSTFS_ACCESS_KEY:      z.string().min(1),
  RUSTFS_SECRET_KEY:      z.string().min(1),
  RUSTFS_BUCKET_DICOM:    z.string().default('pacs-dicom'),
  RUSTFS_BUCKET_THUMBNAILS: z.string().default('pacs-thumbnails'),
  RUSTFS_BUCKET_REPORTS:  z.string().default('ris-reports-pdf'),
  RUSTFS_BUCKET_DOCUMENTS:z.string().default('ris-documents'),

  RESEND_API_KEY:        z.string().optional(),
  EMAIL_FROM:            z.string().default('RIS/PACS <noreply@example.com>'),

  RATE_LIMIT_WINDOW_MS:  z.coerce.number().default(900000),
  // Global: por USUÁRIO/conta (não por IP — vários funcionários atrás do mesmo NAT). Teto anti-abuso.
  RATE_LIMIT_MAX:        z.coerce.number().default(2000),
  // Login: falhas por (IP + CPF/e-mail/usuário) e por IP, em 15 min. Login correto não conta.
  AUTH_RATE_LIMIT_MAX:   z.coerce.number().default(10),
  AUTH_IP_RATE_LIMIT_MAX: z.coerce.number().default(100),
  // Portal do paciente: leituras por conta em 15 min (polling de 20-60 s cabe com folga).
  PORTAL_RATE_LIMIT_MAX: z.coerce.number().default(600),

  BCRYPT_ROUNDS:         z.coerce.number().default(12),
  LOG_LEVEL:             z.enum(['error','warn','info','debug']).default('info'),
  // Arquivo de log (opcional, com rotação). Padrão: só console → `docker compose logs backend`.
  LOG_TO_FILE:           boolFromString(false),
  LOG_DIR:               z.string().default('logs'),

  ORTHANC_URL:           z.string().default('http://localhost:8042'),
  ORTHANC_USER:          z.string().default('orthanc'),
  ORTHANC_PASS:          z.string().default('orthanc'),
  // Segredo compartilhado Orthanc→backend (header X-Webhook-Secret do webhook de estudos
  // recebidos). Em produção o webhook fica DESLIGADO (401) enquanto não for definido.
  ORTHANC_WEBHOOK_SECRET: z.string().min(16, 'ORTHANC_WEBHOOK_SECRET deve ter 16+ caracteres').optional(),

  // Cada sessão de upload em blocos grava seus .part aqui antes de enviar ao Orthanc.
  UPLOAD_TMP_DIR:        z.string().default('/tmp/ris-uploads'),

  // Offset fixo: Brasil não tem mais horário de verão, então basta um valor determinístico.
  SCHEDULE_TZ_OFFSET:    z.string().regex(/^[+-]\d{2}:\d{2}$/).default('-03:00'),

  // Volume compartilhado: o backend grava .wl aqui e o plugin Worklists do Orthanc os serve via C-FIND.
  MWL_DIR:               z.string().default('/var/lib/orthanc/worklists'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:\n', parsed.error.format());
  process.exit(1);
}

// Resend rejeita (403) remetentes em domínios gratuitos/consumidor; validar no boot
// evita que o e-mail ao paciente falhe silenciosamente a cada envio.
if (parsed.data.RESEND_API_KEY) {
  const m = /<([^>]+)>/.exec(parsed.data.EMAIL_FROM);
  const addr = (m ? m[1] : parsed.data.EMAIL_FROM).trim();
  const domain = (addr.split('@')[1] || '').toLowerCase();
  const FREE = ['gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com',
    'yahoo.com.br', 'icloud.com', 'bol.com.br', 'uol.com.br', 'example.com'];
  if (FREE.includes(domain)) {
    console.warn(
      `⚠️  EMAIL_FROM usa o domínio "${domain}", que o Resend NÃO aceita para envio. ` +
      'E-mails ao paciente (boas-vindas, lembretes, notificações) vão FALHAR. ' +
      'Verifique um domínio próprio em https://resend.com/domains e ajuste EMAIL_FROM ' +
      '(ou use onboarding@resend.dev só para testes ao dono da conta).'
    );
  }
}

module.exports = parsed.data;
