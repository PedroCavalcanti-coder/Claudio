'use strict';
/**
 * Orthanc falso em memória para jest: implementa só o que dicomIngest/studies usam
 * (GET /studies|series|instances, /instances/:id/file, POST /tools/find). Use com
 *   jest.mock('../src/services/orthanc', () => require('./helpers/fakeOrthanc').client)
 */
const { Readable } = require('stream');

const store = { studies: new Map(), series: new Map(), instances: new Map() };

function reset() { store.studies.clear(); store.series.clear(); store.instances.clear(); }

/**
 * Cadastra um estudo com N instâncias (1 série). Retorna o id (Orthanc) do estudo.
 */
function addStudy({ id, studyUID, accession = '', patientId = '', patientName = '', modality = 'CR',
  description = 'EXAME', date = '20261002', time = '101500', instances = 1, lastUpdate }) {
  const seriesId = `${id}-s1`;
  const instIds = [];
  for (let i = 1; i <= instances; i++) {
    const iid = `${id}-i${i}`;
    instIds.push(iid);
    store.instances.set(iid, {
      ID: iid, FileSize: 16, TransferSyntaxUID: '1.2.840.10008.1.2.1',
      MainDicomTags: { SOPInstanceUID: `${studyUID}.1.${i}`, SOPClassUID: '1.2.840.10008.5.1.4.1.1.7',
        InstanceNumber: String(i), Columns: '4', Rows: '4' },
    });
  }
  store.series.set(seriesId, {
    ID: seriesId, Instances: instIds,
    MainDicomTags: { SeriesInstanceUID: `${studyUID}.1`, Modality: modality, SeriesNumber: '1' },
  });
  store.studies.set(id, {
    ID: id, Series: [seriesId], LastUpdate: lastUpdate || new Date().toISOString().replace(/[-:]/g, '').slice(0, 15),   // AAAAMMDDTHHMMSS (agora)
    MainDicomTags: { StudyInstanceUID: studyUID, AccessionNumber: accession, StudyDate: date, StudyTime: time, StudyDescription: description },
    PatientMainDicomTags: { PatientID: patientId, PatientName: patientName },
  });
  return id;
}

const notFound = (url) => Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });

const client = {
  async get(url, opts = {}) {
    let m;
    if (url === '/system') return { data: { Version: 'fake' } };
    if (url === '/studies') return { data: [...store.studies.keys()] };
    if ((m = url.match(/^\/studies\/([^/]+)$/))) { const s = store.studies.get(m[1]); if (!s) throw notFound(url); return { data: s }; }
    if ((m = url.match(/^\/series\/([^/]+)$/))) { const s = store.series.get(m[1]); if (!s) throw notFound(url); return { data: s }; }
    if ((m = url.match(/^\/instances\/([^/]+)\/file$/))) {
      if (!store.instances.has(m[1])) throw notFound(url);
      const buf = Buffer.from('DICM-fake-' + m[1]);
      return { data: opts.responseType === 'stream' ? Readable.from([buf]) : buf };
    }
    if ((m = url.match(/^\/instances\/([^/]+)$/))) { const s = store.instances.get(m[1]); if (!s) throw notFound(url); return { data: s }; }
    throw notFound(url);
  },
  async post(url, body) {
    if (url === '/tools/find') {
      const uid = body?.Query?.StudyInstanceUID;
      return { data: [...store.studies.values()].filter((s) => s.MainDicomTags.StudyInstanceUID === uid).map((s) => s.ID) };
    }
    throw notFound(url);
  },
};

module.exports = { client, addStudy, reset, store };
