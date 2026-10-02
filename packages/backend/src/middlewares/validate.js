const { z } = require('zod');
const { AppError } = require('../utils/errors');
const { isValidCns } = require('../utils/cns');

/**
 * Middleware de validação com Zod.
 * Valida body, query e params automaticamente.
 *
 * Uso:
 *   validate({ body: z.object({ name: z.string() }) })
 */
function validate(schemas) {
  return (req, res, next) => {
    const errors = [];

    for (const [key, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        errors.push(...result.error.errors.map(e => ({
          field: `${key}.${e.path.join('.')}`,
          message: e.message,
        })));
      } else {
        req[key] = result.data; // Substitui pelo valor sanitizado/tipado
      }
    }

    if (errors.length > 0) {
      return next(new AppError('Dados inválidos', 422, 'VALIDATION_ERROR', errors));
    }
    next();
  };
}

const schemas = {
  uuid:     z.string().uuid('ID inválido'),
  cpf:      z.string().regex(/^\d{11}$|^\d{3}\.\d{3}\.\d{3}-\d{2}$/, 'CPF inválido'),
  cns:      z.string().regex(/^\d{15}$/, 'CNS deve ter 15 dígitos').refine(isValidCns, 'CNS inválido — dígito verificador não confere'),
  email:    z.string().email('E-mail inválido'),
  phone:    z.string().regex(/^\+?[\d\s\-()]{8,20}$/, 'Telefone inválido'),
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
  uuidParam: z.object({ id: z.string().uuid('ID inválido') }),
};

module.exports = { validate, schemas };
