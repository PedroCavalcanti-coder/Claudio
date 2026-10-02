const { S3Client, PutObjectCommand, GetObjectCommand,
        DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const env = require('./env');

const s3 = new S3Client({
  endpoint: `${env.RUSTFS_USE_SSL ? 'https' : 'http'}://${env.RUSTFS_ENDPOINT}:${env.RUSTFS_PORT}`,
  region: 'us-east-1',           // RUSTFS ignora região, mas o SDK exige
  forcePathStyle: true,           // OBRIGATÓRIO para RUSTFS
  credentials: {
    accessKeyId:     env.RUSTFS_ACCESS_KEY,
    secretAccessKey: env.RUSTFS_SECRET_KEY,
  },
});

// contentLength é necessário ao enviar um stream sem bufferizar (ex.: replicação DICOM).
async function upload(bucket, key, body, contentType, metadata = {}, contentLength) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: metadata,
    ServerSideEncryption: 'AES256',
    ...(Number.isFinite(contentLength) ? { ContentLength: contentLength } : {}),
  }));
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

module.exports = { upload, getPresignedUrl, getStream, exists, remove, BUCKETS };
