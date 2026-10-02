'use strict';
/**
 * E2E HTTP smoke (Fase 2 QA) — exercita os módulos NOVOS com token real de admin
 * contra o backend rodando (http://127.0.0.1:3000). Vai além do probe 401: valida
 * status 200/201 + forma da resposta. Cria algumas linhas marcadas "SMOKE" e as
 * remove no fim (limpeza via /api não existe → aviso p/ limpar por SQL se preciso).
 *
 * Rodar: node scripts/e2e_http_smoke.js
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3000/api/v1';
let token = '';
let pass = 0, fail = 0;

async function call(method, path, body, useToken = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (useToken && token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* no body */ }
  return { status: r.status, data };
}
function check(name, ok, extra = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
  return ok;
}

(async () => {
  console.log('E2E HTTP smoke →', BASE);

  // 1. Login admin
  const login = await call('POST', '/auth/login_admin', { email: 'admin@clinica.com.br', password: 'admin123456' }, false);
  token = login.data?.data?.access_token || login.data?.data?.accessToken || login.data?.access_token || '';
  check('login admin', login.status === 200 && !!token, `status ${login.status}`);
  if (!token) { console.log('sem token — abortando'); process.exit(1); }

  // 2. Unidade + paciente
  const units = await call('GET', '/health-units');
  const unitId = units.data?.data?.[0]?.id;
  check('GET /health-units', units.status === 200 && !!unitId);
  const pts = await call('GET', '/patients?limit=1&page=1');
  const patientId = pts.data?.data?.[0]?.id;
  check('GET /patients', pts.status === 200 && !!patientId);

  // 3. Farmácia — criar estoque + listar + dispensações do paciente
  const stock = await call('POST', '/pharmacy/stock', { drug_name: 'SMOKE Dipirona 500mg', quantity: 10, unit_label: 'comp', health_unit_id: unitId });
  check('POST /pharmacy/stock', stock.status === 201, `status ${stock.status}`);
  const stockList = await call('GET', `/pharmacy/stock?health_unit_id=${unitId}&q=SMOKE`);
  check('GET /pharmacy/stock', stockList.status === 200 && Array.isArray(stockList.data?.data));
  if (patientId) {
    const disp = await call('GET', `/pharmacy/patients/${patientId}/dispensations`);
    check('GET /pharmacy/.../dispensations', disp.status === 200 && Array.isArray(disp.data?.data));
  }

  // 4. Teleconsulta — sessão + sala (capability) + sinalização
  let roomToken = '', sessionId = '';
  if (patientId) {
    const sess = await call('POST', '/teleconsult/sessions', { patient_id: patientId });
    roomToken = sess.data?.data?.room_token; sessionId = sess.data?.data?.id;
    check('POST /teleconsult/sessions', sess.status === 201 && !!roomToken, `status ${sess.status}`);
    if (roomToken) {
      const room = await call('GET', `/teleconsult/room/${roomToken}`, null, false); // sem token = capability
      check('GET /teleconsult/room/:token (sem auth, capability)', room.status === 200 && room.data?.data?.room_token === roomToken);
      const sig = await call('POST', `/teleconsult/room/${roomToken}/signal`, { sender: 'host', kind: 'offer', payload: { sdp: 'x' } }, false);
      check('POST /teleconsult/room/:token/signal', sig.status === 201);
      const got = await call('GET', `/teleconsult/room/${roomToken}/signal?role=guest&since=0`, null, false);
      check('GET signal (guest vê offer do host)', got.status === 200 && got.data?.data?.some?.(s => s.kind === 'offer'));
      if (sessionId) await call('PATCH', `/teleconsult/sessions/${sessionId}/status`, { status: 'ended' });
    }
  }

  // 5. Mensageria, analytics, billing, catálogo
  const outbox = await call('GET', '/messaging/outbox');
  check('GET /messaging/outbox', outbox.status === 200 && Array.isArray(outbox.data?.data));
  const cat = await call('GET', '/catalog/medications?q=dipi');
  check('GET /catalog/medications', cat.status === 200 && Array.isArray(cat.data?.data));

  // 6. Portal-access (gerar acesso ao paciente)
  if (patientId) {
    const pa = await call('POST', `/patients/${patientId}/portal-access`, {});
    check('POST /patients/:id/portal-access', pa.status === 201 || pa.status === 200, `status ${pa.status}`);
  }

  console.log(`\n${fail === 0 ? 'TODOS OK' : 'FALHAS'}: ${pass} pass / ${fail} fail`);
  if (roomToken) console.log('NOTA: 1 estoque "SMOKE" + 1 teleconsulta criados (limpar por SQL se quiser).');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
