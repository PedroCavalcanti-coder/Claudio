'use strict';
require('express-async-errors');
if (process.env.NODE_ENV !== 'test') require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const cookieParser = require('cookie-parser');
const compression  = require('compression');

const env             = require('./config/env');
const logger          = require('./config/logger');
const { healthCheck } = require('./config/database');
const { apiLimiter }  = require('./middlewares/rateLimiter');
const errorHandler    = require('./middlewares/errorHandler');
const { authorize }   = require('./middlewares/authorize');
const authenticate    = require('./middlewares/authenticate');

const authRoutes         = require('./modules/auth/auth.routes');
const patientsRoutes     = require('./modules/patients/patients.routes');
const appointmentsRoutes = require('./modules/appointments/appointments.routes');
const studiesRoutes      = require('./modules/studies/studies.routes');
const reportsRoutes      = require('./modules/reports/reports.routes');
const usersRoutes        = require('./modules/users/users.routes');
const portalRoutes       = require('./modules/portal/portal.routes');
const dicomRoutes        = require('./modules/dicom/dicom.routes');

const consentRoutes       = require('./modules/consent/consent.routes');
const patientPortalRoutes = require('./modules/portal-patient/portal-patient.routes');
const secondOpinionRoutes = require('./modules/second-opinion/second-opinion.routes');
const { router: notifRoutes } = require('./modules/notifications/notifications.routes');
const healthUnitsRoutes   = require('./modules/auth/health-units.routes');
const proceduresRoutes    = require('./modules/procedures/procedures.routes');
const radiologistRoutes   = require('./modules/radiologist/radiologist.routes');
const examNotesRoutes     = require('./modules/exam-notes/exam-notes.routes');
const referralsRoutes     = require('./modules/referrals/referrals.routes');
const auditRoutes         = require('./modules/audit/audit.routes');
const availabilityRoutes  = require('./modules/availability/availability.routes');
const ehrRoutes           = require('./modules/ehr/ehr.routes');
const analyticsRoutes     = require('./modules/analytics/analytics.routes');
const catalogRoutes       = require('./modules/catalog/catalog.routes');
const billingRoutes       = require('./modules/billing/billing.routes');
const pharmacyRoutes      = require('./modules/pharmacy/pharmacy.routes');
const messagingRoutes     = require('./modules/messaging/messaging.routes');
const teleconsultRoutes   = require('./modules/teleconsult/teleconsult.routes');

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

app.use(cors({
  origin:         env.FRONTEND_URL,
  credentials:    true,
  methods:        ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Portal-Token'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(compression());

app.use(morgan('combined', {
  stream: { write: msg => logger.info(msg.trim()) },
  skip:   req => req.path === '/health',
}));

app.use(env.API_PREFIX, apiLimiter);

const P = env.API_PREFIX;

async function healthHandler(req, res) {
  try {
    const dbTime = await healthCheck();
    res.json({ status: 'ok', db: dbTime, uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
}
app.get('/health',         healthHandler);   // compat: clientes antigos chamam sem prefixo
app.get(`${P}/health`,     healthHandler);

app.use(`${P}/auth`,            authRoutes);
app.use(`${P}/patients`,        patientsRoutes);
app.use(`${P}/appointments`,    appointmentsRoutes);
app.use(`${P}/studies`,         studiesRoutes);
app.use(`${P}/reports`,         reportsRoutes);
app.use(`${P}/users`,           usersRoutes);
app.use(`${P}/portal`,          portalRoutes);
app.use(`${P}/dicom`,           dicomRoutes);

app.use(`${P}/consent`,         consentRoutes);
app.use(`${P}/patient-portal`,  patientPortalRoutes);
app.use(`${P}/second-opinion`,  secondOpinionRoutes);
app.use(`${P}/notifications`,   notifRoutes);
app.use(`${P}/health-units`,    healthUnitsRoutes);
app.use(`${P}/procedures`,      proceduresRoutes);
app.use(`${P}/radiologist`,     radiologistRoutes);
app.use(`${P}/referrals`,       referralsRoutes);
app.use(`${P}/audit`,           auditRoutes);
app.use(`${P}/availability`,    availabilityRoutes);
app.use(`${P}/ehr`,             ehrRoutes);
app.use(`${P}/analytics`,       analyticsRoutes);
app.use(`${P}/catalog`,         catalogRoutes);
app.use(`${P}/billing`,         billingRoutes);
app.use(`${P}/pharmacy`,        pharmacyRoutes);
app.use(`${P}/messaging`,       messagingRoutes);
app.use(`${P}/teleconsult`,     teleconsultRoutes);
// exam-notes registra rotas tanto em /studies/:id/notes (lista/cria) quanto /notes/:id (patch/delete)
app.use(`${P}`,                 examNotesRoutes);

app.get(`${P}/studies/:studyUID/series`,
  authenticate, authorize('radiologist'),
  require('./modules/dicom/dicom.controller').getStudySeries
);

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Rota não encontrada: ${req.method} ${req.path}` });
});

app.use(errorHandler);

if (require.main === module) {
  // 1) schema em dia (idempotente)  2) chave de criptografia correta — senão recusa subir, com mensagem clara.
  Promise.resolve(env.AUTO_MIGRATE ? require('./services/migrate').migrate() : null)
    .then(() => require('./services/keyCheck').verifyEncryptionKey())
    .then(() => start())
    .catch((err) => {
      logger.error(`❌ ${err.message}`);
      console.error(`\n❌ ${err.message}\n`);
      process.exit(1);
    });
}

function start() {
  // Worker de email (Bull) roda embutido no mesmo processo da API, não separado.
  require('./queues/emailQueue');
  logger.info('📧 Worker de email (Bull) inicializado');

  require('./jobs/scheduler').startSchedulers();

  // Índice de busca por nome: indexa em segundo plano quem ainda não tem tokens (upgrade).
  require('./services/patientNameIndex').backfillNameTokens(require('./config/database'))
    .catch((e) => logger.error('Índice de nomes falhou', { error: e.message }));

  // Cria os buckets do RustFS (instalação nova sobe vazia). Em segundo plano, com
  // retry/backoff: se o storage demorar, a API sobe mesmo assim.
  require('./config/storage').ensureBuckets().catch(() => {});

  app.listen(env.PORT, () => {
    logger.info(`🚀 RIS/PACS API rodando na porta ${env.PORT} [${env.NODE_ENV}]`);
  });
}

module.exports = app;
