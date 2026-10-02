const { verifyAccessToken } = require('../services/token');
const { AppError } = require('../utils/errors');
const db = require('../config/database');

/**
 * Middleware de autenticação JWT RS256.
 * Extrai o token do header Authorization: Bearer <token>, valida a assinatura e
 * confirma que o usuário do token ainda existe e está ativo. Esse último passo
 * evita que um token assinado mas ÓRFÃO (usuário removido/recriado — ex.: re-seed
 * do banco em desenvolvimento) passe na autenticação e só quebre mais tarde numa
 * violação de FK (created_by/administered_by → auth.users). Nesse caso devolve
 * 401 SESSION_INVALID, forçando um login novo em vez de um erro obscuro.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Token de acesso não fornecido', 401));
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = await verifyAccessToken(token);
  } catch (err) {
    if (err.code === 'ERR_JWT_EXPIRED') {
      return next(new AppError('Token expirado', 401, 'TOKEN_EXPIRED'));
    }
    return next(new AppError('Token inválido', 401, 'TOKEN_INVALID'));
  }

  try {
    const { rows } = await db.query(`SELECT is_active FROM auth.users WHERE id = $1`, [payload.sub]);
    if (!rows.length) {
      return next(new AppError('Sessão inválida — faça login novamente.', 401, 'SESSION_INVALID'));
    }
    if (rows[0].is_active === false) {
      return next(new AppError('Conta inativa. Contate o administrador.', 401, 'ACCOUNT_INACTIVE'));
    }
    req.user = payload; // { sub, email, role, name, health_unit_id, ... }
    next();
  } catch (err) {
    next(err); // erro de banco → 500 (não mascarar como token inválido)
  }
}

module.exports = authenticate;
