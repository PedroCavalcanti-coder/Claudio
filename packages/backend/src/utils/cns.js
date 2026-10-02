'use strict';
/**
 * Validação do Cartão Nacional de Saúde (CNS) — dígito verificador.
 *
 * Regras oficiais (DATASUS):
 *  - 15 dígitos.
 *  - CNS definitivo: começa com 1 ou 2 → validação baseada no PIS/PASEP
 *    (11 primeiros dígitos + 4 de verificação, peso 15..1).
 *  - CNS provisório: começa com 7, 8 ou 9 → soma ponderada (peso 15..1)
 *    múltipla de 11.
 *  - Demais dígitos iniciais (0,3,4,5,6) são inválidos.
 */
function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function isValidCns(value) {
  const cns = onlyDigits(value);
  if (!/^\d{15}$/.test(cns)) return false;

  const first = cns[0];
  if (first === '1' || first === '2') return validDefinitive(cns);
  if (first === '7' || first === '8' || first === '9') return validProvisional(cns);
  return false;
}

function validProvisional(cns) {
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += Number(cns[i]) * (15 - i);
  return sum % 11 === 0;
}

function validDefinitive(cns) {
  const pis = cns.slice(0, 11);
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += Number(pis[i]) * (15 - i);
  let resto = sum % 11;
  let dv = 11 - resto;
  if (dv === 11) dv = 0;

  let resultado;
  if (dv === 10) {
    sum += 2;
    resto = sum % 11;
    dv = 11 - resto;
    resultado = `${pis}001${dv}`;
  } else {
    resultado = `${pis}000${dv}`;
  }
  return resultado === cns;
}

module.exports = { isValidCns, onlyDigits };
