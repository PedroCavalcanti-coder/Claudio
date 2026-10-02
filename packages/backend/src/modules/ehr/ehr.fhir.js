'use strict';
/**
 * Gera um Bundle FHIR R4 tipo "document" aproximando o RAC (Registro de
 * Atendimento Clínico) da RNDS — https://rnds-fhir.saude.gov.br/.
 *
 * STUB: monta e devolve o Bundle para inspeção/integração futura. NÃO transmite
 * ao DATASUS — o envio real exige credenciamento do estabelecimento + certificado
 * ICP-Brasil e o connector oficial (Fase 4).
 */
const GENDER = { M: 'male', F: 'female', O: 'other' };
const ref = (id) => `urn:uuid:${id}`;
const escapeXml = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function buildRacBundle({ encounter, patient, practitioner, unit, notes, problems }) {
  const now = new Date().toISOString();

  const patientRes = {
    resourceType: 'Patient', id: patient.id,
    name: [{ text: patient.name || 'Paciente' }],
    gender: GENDER[patient.gender] || 'unknown',
    birthDate: patient.birth_date ? String(patient.birth_date).slice(0, 10) : undefined,
  };
  const practRes = { resourceType: 'Practitioner', id: practitioner.id, name: [{ text: practitioner.name }] };
  const encounterRes = {
    resourceType: 'Encounter', id: encounter.id,
    status: encounter.status === 'closed' ? 'finished' : 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
    subject: { reference: ref(patient.id) },
    participant: [{ individual: { reference: ref(practitioner.id) } }],
    period: { start: encounter.started_at, end: encounter.closed_at || undefined },
  };
  const conditionRes = (problems || []).filter((p) => p.cid10_code).map((p) => ({
    resourceType: 'Condition', id: p.id,
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: p.status === 'resolved' ? 'resolved' : 'active' }] },
    code: { coding: [{ system: 'urn:oid:2.16.840.1.113883.6.3', code: p.cid10_code, display: p.title }], text: p.title },
    subject: { reference: ref(patient.id) },
  }));
  const sections = (notes || []).map((n) => ({
    title: 'Evolução clínica (SOAP)',
    text: {
      status: 'generated',
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${
        [['S', n.subjective], ['O', n.objective], ['A', n.assessment], ['P', n.plan]]
          .filter(([, v]) => v).map(([k, v]) => `<p><b>${k}:</b> ${escapeXml(v)}</p>`).join('') || '<p>—</p>'}</div>`,
    },
  }));
  const composition = {
    resourceType: 'Composition', id: `comp-${encounter.id}`,
    status: 'final',
    type: { coding: [{ system: 'http://loinc.org', code: '34133-9', display: 'Summary of episode note' }], text: 'Registro de Atendimento Clínico' },
    subject: { reference: ref(patient.id) },
    encounter: { reference: ref(encounter.id) },
    date: now,
    author: [{ reference: ref(practitioner.id) }],
    title: 'Registro de Atendimento Clínico',
    custodian: unit && unit.name ? { display: unit.name } : undefined,
    section: sections.length ? sections : [{ title: 'Evolução clínica', text: { status: 'generated', div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Sem evolução assinada.</p></div>' } }],
  };

  const entry = [composition, patientRes, practRes, encounterRes, ...conditionRes]
    .map((r) => ({ fullUrl: ref(r.id), resource: r }));
  return { resourceType: 'Bundle', type: 'document', timestamp: now, entry };
}

module.exports = { buildRacBundle };
