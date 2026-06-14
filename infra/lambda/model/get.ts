import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { log } from '../shared/logger';

const s3 = new S3Client({});
const MODELS_BUCKET = process.env.MODELS_BUCKET!;
// Points at the current model version's manifest, e.g. mxbai/v1/manifest.json.
// Bump this (and upload the artefacts) to roll out a new model.
const MANIFEST_KEY = process.env.MODEL_MANIFEST_KEY!;

interface Manifest {
  version: string;      // e.g. "mxbai-v1"
  artifactKey: string;  // S3 key of the zipped .mlpackage
  sha256: string;       // hex sha256 of the zip
  dim: number;          // 1024
  queryPrefix: string;  // prefix to prepend to search queries before embedding
}

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) { log.warn('model:unauthorised'); return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) }; }

  // Read the manifest describing the current model.
  let manifest: Manifest;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: MODELS_BUCKET, Key: MANIFEST_KEY }));
    manifest = JSON.parse(await res.Body!.transformToString()) as Manifest;
  } catch (e) {
    log.error('model:manifest_missing', { key: MANIFEST_KEY, error: String(e) });
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ error: 'Model not available yet' }) };
  }
  log.info('model:served', { userId, version: manifest.version });

  // Presigned GET for the model artefact (15 min).
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: MODELS_BUCKET, Key: manifest.artifactKey }),
    { expiresIn: 900 },
  );

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: manifest.version,
      sha256: manifest.sha256,
      dim: manifest.dim,
      queryPrefix: manifest.queryPrefix,
      url,
      expiresIn: 900,
    }),
  };
}
