const { S3Client, PutObjectCommand, GetObjectCommand,
        DeleteObjectCommand, HeadObjectCommand,
        HeadBucketCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const env = require('./env');
const logger = require('./logger');

const s3 = new S3Client({
  endpoint: `${env.RUSTFS_USE_SSL ? 'https' : 'http'}://${env.RUSTFS_ENDPOINT}:${env.RUSTFS_PORT}`,
  region: 'us-east-1',           // RUSTFS ignora região, mas o SDK exige
  forcePathStyle: true,           // OBRIGATÓRIO para RUSTFS
  credentials: {
    accessKeyId:     env.RUSTFS_ACCESS_KEY,
    secretAccessKey: env.RUSTFS_SECRET_KEY,
  },
});

const isMissingBucket = (err) =>
  err?.name === 'NoSuchBucket' || err?.Code === 'NoSuchBucket' ||
  err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404;

// Garante um bucket: HeadBucket → CreateBucket se não existir. Idempotente.
async function ensureBucket(bucket) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return false;
  } catch (err) {
    if (!isMissingBucket(err)) throw err;
  }
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err) {
    // Corrida entre instâncias: outro processo criou entre o Head e o Create.
    if (err?.name !== 'BucketAlreadyOwnedByYou' && err?.name !== 'BucketAlreadyExists') throw err;
    return false;
  }
  return true;
}

// Cria os buckets que o sistema usa. Numa instalação nova o RustFS sobe vazio e
// todo PutObject falharia com NoSuchBucket. Tenta com backoff (o RustFS pode
// demorar a aceitar conexões) e NUNCA lança: o boot da API não depende do storage.
// Retorna { ok, created[], failed[] }.
async function ensureBuckets({ retries = 6, baseDelayMs = 2000 } = {}) {
  const names = [...new Set(Object.values(BUCKETS))];
  const created = [];
  let pending = names;
  for (let attempt = 0; attempt <= retries && pending.length; attempt++) {
    const failed = [];
    for (const b of pending) {
      try {
        if (await ensureBucket(b)) created.push(b);
      } catch (err) {
        failed.push(b);
        if (attempt === retries) logger.error('Storage: não foi possível garantir o bucket', { bucket: b, error: err.message });
      }
    }
    pending = failed;
    if (pending.length && attempt < retries) {
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
    }
  }
  if (created.length) logger.info('Storage: buckets criados', { buckets: created });
  return { ok: pending.length === 0, created, failed: pending };
}

// contentLength é necessário ao enviar um stream sem bufferizar (ex.: replicação DICOM).
async function upload(bucket, key, body, contentType, metadata = {}, contentLength) {
  const put = () => s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: metadata,
    ServerSideEncryption: 'AES256',
    ...(Number.isFinite(contentLength) ? { ContentLength: contentLength } : {}),
  }));
  try {
    await put();
  } catch (err) {
    // Bucket ausente (RustFS recriado/volume novo) e o corpo ainda é reenviável
    // (Buffer/string): cria o bucket e tenta uma vez mais. Streams não são reenviáveis.
    if (err?.name !== 'NoSuchBucket' || (typeof body !== 'string' && !Buffer.isBuffer(body))) throw err;
    await ensureBucket(bucket);
    await put();
  }
  return key;
}

async function getPresignedUrl(bucket, key, expiresInSeconds = 3600) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

async function getStream(bucket, key) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Body;
}

async function exists(bucket, key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function remove(bucket, key) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

const BUCKETS = {
  DICOM:       env.RUSTFS_BUCKET_DICOM,
  THUMBNAILS:  env.RUSTFS_BUCKET_THUMBNAILS,
  REPORTS:     env.RUSTFS_BUCKET_REPORTS,
  DOCUMENTS:   env.RUSTFS_BUCKET_DOCUMENTS,
};

module.exports = { upload, getPresignedUrl, getStream, exists, remove, ensureBucket, ensureBuckets, BUCKETS };
