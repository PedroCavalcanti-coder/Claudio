'use strict';
/**
 * Encoder DICOM Part-10 mínimo (Explicit VR Little Endian).
 * Suficiente para gerar arquivos de Modality Worklist (.wl) servidos pelo
 * plugin Worklists do Orthanc via C-FIND. NÃO é um encoder completo: cobre os
 * VRs e o aninhamento de 1 sequência (ScheduledProcedureStepSequence) usados na MWL.
 *
 * Referências: DICOM PS3.5 (estrutura/codificação) e PS3.10 (formato de arquivo).
 */

// VRs com cabeçalho de comprimento "longo" (reservado 2 bytes + length 4 bytes).
const LONG_VRS = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN']);
const EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';
// Modality Worklist Information Model – FIND (usado no meta header)
const MWL_FIND_SOP_CLASS = '1.2.840.10008.5.1.4.31';

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function tag(group, elem) { return Buffer.concat([u16(group), u16(elem)]); }

function padEven(buf, padByte) {
  return buf.length % 2 === 0 ? buf : Buffer.concat([buf, Buffer.from([padByte])]);
}

function valueBytes(vr, value) {
  if (vr === 'OB' || vr === 'UN') return padEven(Buffer.isBuffer(value) ? value : Buffer.from(value), 0x00);
  if (vr === 'UL') return u32(value);
  if (vr === 'US') return u16(value);
  // VRs de texto — Latin-1; UI é padded com NUL, os demais com espaço.
  const s = String(value ?? '');
  return padEven(Buffer.from(s, 'latin1'), vr === 'UI' ? 0x00 : 0x20);
}

// Codifica UM elemento. Para SQ, `value` é um array de itens, cada item é um
// array de elementos { tag:[g,e], vr, value } — sequência de comprimento indefinido.
function encodeElement(group, elem, vr, value) {
  const t = tag(group, elem);

  if (vr === 'SQ') {
    const parts = [];
    for (const item of value) {
      parts.push(tag(0xFFFE, 0xE000), u32(0xFFFFFFFF));  // Item, comprimento indefinido
      parts.push(encodeDataset(item));
      parts.push(tag(0xFFFE, 0xE00D), u32(0));            // Item Delimitation
    }
    parts.push(tag(0xFFFE, 0xE0DD), u32(0));              // Sequence Delimitation
    const body = Buffer.concat(parts);
    return Buffer.concat([t, Buffer.from('SQ', 'latin1'), u16(0), u32(0xFFFFFFFF), body]);
  }

  const val = valueBytes(vr, value);
  if (LONG_VRS.has(vr)) {
    return Buffer.concat([t, Buffer.from(vr, 'latin1'), u16(0), u32(val.length), val]);
  }
  return Buffer.concat([t, Buffer.from(vr, 'latin1'), u16(val.length), val]);
}

// `elements` em ORDEM ascendente de tag (requisito do DICOM).
function encodeDataset(elements) {
  return Buffer.concat(elements.map(e => encodeElement(e.tag[0], e.tag[1], e.vr, e.value)));
}

/**
 * Monta um arquivo DICOM Part-10 completo (preâmbulo + DICM + meta + dataset).
 * @param {Array} datasetElements  elementos do dataset (ordem ascendente)
 * @param {{sopInstanceUID:string, sopClassUID?:string}} opts
 */
function buildPart10(datasetElements, { sopInstanceUID, sopClassUID = MWL_FIND_SOP_CLASS }) {
  const metaBody = Buffer.concat([
    encodeElement(0x0002, 0x0001, 'OB', Buffer.from([0x00, 0x01])),     // FileMetaInformationVersion
    encodeElement(0x0002, 0x0002, 'UI', sopClassUID),                    // MediaStorageSOPClassUID
    encodeElement(0x0002, 0x0003, 'UI', sopInstanceUID),                 // MediaStorageSOPInstanceUID
    encodeElement(0x0002, 0x0010, 'UI', EXPLICIT_VR_LE),                 // TransferSyntaxUID
    encodeElement(0x0002, 0x0012, 'UI', '1.2.826.0.1.3680043.8.498.1'),  // ImplementationClassUID
    encodeElement(0x0002, 0x0013, 'SH', 'RISPACS_MWL'),                  // ImplementationVersionName
  ]);
  const meta = Buffer.concat([
    encodeElement(0x0002, 0x0000, 'UL', metaBody.length),                // group length
    metaBody,
  ]);
  return Buffer.concat([
    Buffer.alloc(128),                  // preâmbulo
    Buffer.from('DICM', 'latin1'),
    meta,
    encodeDataset(datasetElements),
  ]);
}

module.exports = { buildPart10, encodeDataset, EXPLICIT_VR_LE };
