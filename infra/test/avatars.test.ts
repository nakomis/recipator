// RECP-51 — member avatars. Exercises the key convention, the presigned-PUT upload
// handler, and the GET /config presign branches, all without touching AWS.

process.env.AVATARS_BUCKET = 'recipator-avatars-test';
process.env.GROUP_MEMBERS_PARAM = '/recipator/test/group-members';

// S3 commands are mocked to plain tagged objects so the fake `send` can branch on them.
const s3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: s3Send })),
  HeadObjectCommand: jest.fn((input) => ({ _type: 'head', input })),
  GetObjectCommand: jest.fn((input) => ({ _type: 'get', input })),
  PutObjectCommand: jest.fn((input) => ({ _type: 'put', input })),
}));

const ssmSend = jest.fn();
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: ssmSend })),
  GetParameterCommand: jest.fn((input) => ({ _type: 'getParam', input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async (_client, cmd) => `https://signed.example/${cmd._type}/${cmd.input.Key}`),
}));

import { avatarKey, AVATAR_CONTENT_TYPE } from '../lambda/shared/avatars';

function event(sub?: string) {
  return { requestContext: { authorizer: { jwt: { claims: sub ? { sub } : {} } } } } as never;
}

describe('avatarKey', () => {
  it('uses the avatars/<userId>.jpg convention', () => {
    expect(avatarKey('abc-123')).toBe('avatars/abc-123.jpg');
    expect(AVATAR_CONTENT_TYPE).toBe('image/jpeg');
  });
});

describe('POST /config/avatar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects an unauthenticated caller', async () => {
    const { handler } = await import('../lambda/config/avatar-put');
    const res = (await handler(event(undefined))) as { statusCode: number };
    expect(res.statusCode).toBe(401);
  });

  it('returns a presigned PUT for the caller\'s own key', async () => {
    const { handler } = await import('../lambda/config/avatar-put');
    const res = (await handler(event('user-42'))) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toBe('https://signed.example/put/avatars/user-42.jpg');
    expect(body.contentType).toBe('image/jpeg');
  });
});

describe('GET /config avatars', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    ssmSend.mockResolvedValue({
      Parameter: { Value: JSON.stringify([{ userId: 'has-avatar' }, { userId: 'no-avatar' }]) },
    });
    // Head succeeds for has-avatar, 404s for no-avatar.
    s3Send.mockImplementation(async (cmd) => {
      if (cmd._type === 'head' && cmd.input.Key === avatarKey('no-avatar')) {
        throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
      }
      return {};
    });
  });

  it('presigns avatarUrl only for members who have one', async () => {
    const { handler } = await import('../lambda/config/get');
    const res = (await handler(event('whoever'))) as { statusCode: number; body: string };
    const { groupMembers } = JSON.parse(res.body);
    const byId = Object.fromEntries(groupMembers.map((m: { userId: string }) => [m.userId, m]));
    expect(byId['has-avatar'].avatarUrl).toBe('https://signed.example/get/avatars/has-avatar.jpg');
    expect(byId['no-avatar'].avatarUrl).toBeUndefined();
  });
});
