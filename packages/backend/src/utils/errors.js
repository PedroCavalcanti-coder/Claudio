class AppError extends Error {
  constructor(message, status = 500, code = null, details = null) {
    super(message);
    this.name    = 'AppError';
    this.status  = status;
    this.code    = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Recurso') {
    super(`${resource} não encontrado`, 404, 'NOT_FOUND');
  }
}

class UnauthorizedError extends AppError {
  constructor(msg = 'Não autorizado') {
    super(msg, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor() {
    super('Acesso negado', 403, 'FORBIDDEN');
  }
}

module.exports = { AppError, NotFoundError, UnauthorizedError, ForbiddenError };
