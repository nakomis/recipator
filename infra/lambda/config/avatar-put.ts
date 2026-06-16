// POST /config/avatar (RECP-51) — issue a presigned PUT URL so the app can upload
// the caller's own avatar straight to S3 (the image bytes never pass through Lambda
// or API Gateway, dodging their payload limits). The key is derived from the caller's
// Cognito sub, so a user can only ever write their own avatar.

import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { log } from '../shared/logger';
import { AVATAR_CONTENT_TYPE, avatarKey } from '../shared/avatars';

const s3 = new S3Client({});
const AVATARS_BUCKET = process.env.AVATARS_BUCKET!;

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) {
    log.warn('avatar:unauthorised');
    return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorised' }) };
  }

  const Key = avatarKey(userId);
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: AVATARS_BUCKET, Key, ContentType: AVATAR_CONTENT_TYPE }),
    { expiresIn: 900 },
  );
  log.info('avatar:presigned_put', { userId });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    // contentType is echoed so the client sets the same header on its PUT (a presigned
    // URL signs the Content-Type, so the upload must match exactly).
    body: JSON.stringify({ url, contentType: AVATAR_CONTENT_TYPE, expiresIn: 900 }),
  };
}
