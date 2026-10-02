/**
 * Utilitários para respostas padronizadas da API.
 */

function success(res, data, message = 'OK', status = 200) {
  return res.status(status).json({ success: true, message, data });
}

function created(res, data, message = 'Criado com sucesso') {
  return success(res, data, message, 201);
}

function paginated(res, { data, total, page, limit }) {
  return res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
}

function noContent(res) {
  return res.status(204).send();
}

module.exports = { success, created, paginated, noContent };
