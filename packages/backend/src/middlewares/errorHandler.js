const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

/**
 * Middleware global de tratamento de erros.
 * Deve ser o ÚLTIMO middleware registrado no app.
 */
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    logger.warn('AppError', {
      message: err.message,
      code:    err.code,
      status:  err.status,
      path:    req.path,
    });
    return res.status(err.status).json({
      success: false,
      message: err.message,
      code:    err.code || undefined,
      errors:  err.details || undefined,
    });
  }

  // Erro de banco — violação de constraint única
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'Registro duplicado',
      code:    'DUPLICATE_ENTRY',
    });
  }

  // Erro de banco — chave estrangeira
  if (err.code === '23503') {
    logger.error('Violação de chave estrangeira (23503)', {
      table:      err.table,
      constraint: err.constraint,
      detail:     err.detail,
      column:     err.column,
      path:       req.path,
      method:     req.method,
    });
    return res.status(422).json({
      success: false,
      message: 'Referência inválida',
      code:    'FOREIGN_KEY_VIOLATION',
    });
  }

  logger.error('Erro não tratado', {
    message: err.message,
    stack:   err.stack,
    path:    req.path,
    method:  req.method,
  });

  return res.status(500).json({
    success: false,
    message: 'Erro interno do servidor',
    code:    'INTERNAL_ERROR',
  });
}

module.exports = errorHandler;
