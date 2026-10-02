-- ─────────────────────────────────────────────────────────────────────────────
-- RIS/PACS — avisa o backend quando um estudo recebido (C-STORE) fica ESTÁVEL.
--
-- O Orthanc chama OnStableStudy depois de `StableAge` segundos sem novas instâncias
-- do estudo. Aqui fazemos POST no webhook do backend (rede interna do compose, não
-- passa pelo nginx) com o segredo compartilhado. O backend vincula o estudo ao
-- agendamento pelo AccessionNumber da worklist; se falhar/ficar fora do ar, a
-- varredura periódica do backend recupera o estudo depois.
--
-- URL e segredo vêm de orthanc.json ("RisWebhook"); o segredo é ${ORTHANC_WEBHOOK_SECRET}
-- do .env (substituição de variáveis de ambiente do próprio Orthanc).
-- ─────────────────────────────────────────────────────────────────────────────

function OnStableStudy(studyId, tags, metadata)
  local cfg = GetOrthancConfiguration()['RisWebhook']
  if cfg == nil or cfg['Url'] == nil then
    print('[ris-webhook] "RisWebhook.Url" ausente em orthanc.json — estudo ' .. studyId .. ' não enviado ao RIS')
    return
  end

  local headers = { ['Content-Type'] = 'application/json' }
  if cfg['Secret'] ~= nil and cfg['Secret'] ~= '' then
    headers['X-Webhook-Secret'] = cfg['Secret']
  end

  SetHttpTimeout(30)
  local ok, err = pcall(function()
    HttpPost(cfg['Url'], DumpJson({ ID = studyId }, true), headers)
  end)
  if ok then
    print('[ris-webhook] estudo ' .. studyId .. ' enviado ao RIS')
  else
    print('[ris-webhook] FALHA ao avisar o RIS sobre o estudo ' .. studyId .. ': ' .. tostring(err) ..
          ' (a varredura do backend recupera em até 10 min)')
  end
end
