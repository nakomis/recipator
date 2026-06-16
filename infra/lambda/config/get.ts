import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { log } from '../shared/logger';
import { avatarKey } from '../shared/avatars';

const ssm = new SSMClient({});
const s3 = new S3Client({});
const GROUP_MEMBERS_PARAM = process.env.GROUP_MEMBERS_PARAM!;
const AVATARS_BUCKET = process.env.AVATARS_BUCKET;

interface GroupMember {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
}

// Membership changes are rare, so the SSM value is cached for the container's
// lifetime. Avatar URLs are presigned (and so expire), so they are NEVER cached —
// they're generated fresh on every invocation (RECP-51).
let cachedMembers: string | undefined;

/** A presigned GET URL for the member's avatar, or undefined if none is set. */
async function avatarUrlFor(userId: string): Promise<string | undefined> {
  if (!AVATARS_BUCKET) return undefined;
  const Key = avatarKey(userId);
  try {
    await s3.send(new HeadObjectCommand({ Bucket: AVATARS_BUCKET, Key }));
  } catch {
    return undefined; // no avatar set (or not yet uploaded)
  }
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: AVATARS_BUCKET, Key }), { expiresIn: 3600 });
}

export async function handler(_event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const fromCache = cachedMembers !== undefined;
  if (!cachedMembers) {
    const res = await ssm.send(new GetParameterCommand({ Name: GROUP_MEMBERS_PARAM }));
    cachedMembers = res.Parameter!.Value!;
  }

  const members = JSON.parse(cachedMembers) as GroupMember[];
  const groupMembers = await Promise.all(
    members.map(async (m) => ({ ...m, avatarUrl: await avatarUrlFor(m.userId) })),
  );

  log.info('config:get', {
    members: groupMembers.length,
    withAvatar: groupMembers.filter((m) => m.avatarUrl).length,
    cached: fromCache,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupMembers }),
  };
}
