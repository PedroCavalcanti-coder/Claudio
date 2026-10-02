'use strict';
/** P0-4: buckets do RustFS são criados no boot (storage vazio) e sob demanda. */
const storage = require('../src/config/storage');

const names = Object.values(storage.BUCKETS);

describe('storage.ensureBuckets', () => {
  it('cria os 4 buckets num storage vazio e é idempotente', async () => {
    const buckets = global.__FAKE_S3__.buckets;
    buckets.clear();
    const first = await storage.ensureBuckets({ retries: 0 });
    expect(first.ok).toBe(true);
    expect(first.created.sort()).toEqual([...names].sort());
    expect([...buckets.keys()].sort()).toEqual([...names].sort());

    const second = await storage.ensureBuckets({ retries: 0 });
    expect(second).toEqual({ ok: true, created: [], failed: [] });
  });

  it('upload recria um bucket que sumiu (NoSuchBucket) quando o corpo é Buffer', async () => {
    global.__FAKE_S3__.buckets.clear();
    await storage.upload(storage.BUCKETS.DOCUMENTS, 'a/b.pdf', Buffer.from('%PDF-x'), 'application/pdf');
    expect(await storage.exists(storage.BUCKETS.DOCUMENTS, 'a/b.pdf')).toBe(true);
  });
});
