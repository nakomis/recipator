// PATCH /recipes/{id} — recipe editing and version snapshots (RECP-59).
// DynamoDB, SSM group membership, and the embed Lambda are mocked; no AWS calls.

process.env.RECIPES_TABLE = 'recipes-test';
process.env.RECIPE_VERSIONS_TABLE = 'versions-test';
process.env.EMBED_FUNCTION_NAME = 'embed-test';

const sent: { name: string; input: any }[] = [];
let existingItem: Record<string, unknown> | undefined;

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const record = (name: string) => class {
    constructor(public input: unknown) { (this as any).__name = name; }
  };
  return {
    DynamoDBDocumentClient: {
      from: () => ({
        send: async (cmd: any) => {
          sent.push({ name: cmd.__name, input: cmd.input });
          return cmd.__name === 'Get' ? { Item: existingItem } : {};
        },
      }),
    },
    GetCommand: record('Get'),
    PutCommand: record('Put'),
    UpdateCommand: record('Update'),
  };
});
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));

const mockInvoke = jest.fn(async () => ({}));
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class { send = mockInvoke; },
  InvokeCommand: class { constructor(public input: unknown) {} },
  InvocationType: { Event: 'Event' },
}));

const mockVisibleOwnerIds = jest.fn(async (caller: string) => new Set([caller]));
jest.mock('../lambda/shared/group', () => ({
  visibleOwnerIds: (caller: string) => mockVisibleOwnerIds(caller),
}));

import { handler } from '../lambda/recipes/update';

const RECIPE = {
  userId: 'owner-1',
  recipeId: 'r-1',
  title: 'Old Title',
  url: 'https://example.com/recipe',
  savedAt: '2026-01-01T00:00:00.000Z',
  ingredients: ['200g flour', '2 eggs'],
  method: ['Mix', 'Bake'],
  markdown: '# Old Title\n',
  imageUrl: 'https://example.com/old.jpg',
};

function patch(body: object, { sub = 'owner-1', userId }: { sub?: string; userId?: string } = {}) {
  return {
    pathParameters: { id: 'r-1' },
    queryStringParameters: userId ? { userId } : undefined,
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub, email: `${sub}@example.com` } } } },
  } as never;
}

const parse = (res: any) => JSON.parse(res.body);
const commands = (name: string) => sent.filter(s => s.name === name);

beforeEach(() => {
  sent.length = 0;
  existingItem = { ...RECIPE };
  mockInvoke.mockClear();
  mockVisibleOwnerIds.mockImplementation(async (caller: string) => new Set([caller]));
});

describe('PATCH /recipes/{id}', () => {
  it('snapshots the previous version before overwriting a content edit', async () => {
    const res: any = await handler(patch({ title: 'New Title' }));
    expect(res.statusCode).toBe(200);

    const [version] = commands('Put');
    expect(version.input.TableName).toBe('versions-test');
    expect(version.input.Item).toMatchObject({
      recipeId: 'r-1',
      userId: 'owner-1',
      changedBy: 'owner-1',
      changedFields: ['title'],
      title: 'Old Title',              // the value as it was, not the new one
      ingredients: RECIPE.ingredients,
      markdown: RECIPE.markdown,
    });
    expect(typeof version.input.Item.changedAt).toBe('string');
  });

  it('rebuilds the markdown, including notes, and returns the updated recipe', async () => {
    const res: any = await handler(patch({ method: ['Mix well', 'Bake'], notes: 'Halve the salt' }));

    const [update] = commands('Update');
    const markdown = update.input.ExpressionAttributeValues[':markdown'] as string;
    expect(markdown).toContain('# Old Title');
    expect(markdown).toContain('1. Mix well');
    expect(markdown).toContain('## Notes\n\nHalve the salt');
    // `method` is a DynamoDB reserved word — every name must be aliased.
    expect(update.input.UpdateExpression).toContain('#method = :method');
    expect(parse(res).recipe.notes).toBe('Halve the salt');
  });

  it('re-embeds only when the embedded text (title or ingredients) changed', async () => {
    await handler(patch({ method: ['Only the method moved'] }));
    expect(mockInvoke).not.toHaveBeenCalled();

    await handler(patch({ ingredients: ['300g flour'] }));
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('does not version an imageUrl-only patch', async () => {
    const res: any = await handler(patch({ imageUrl: 'https://example.com/new.jpg' }));
    expect(res.statusCode).toBe(200);
    expect(commands('Put')).toHaveLength(0);
    expect(commands('Update')).toHaveLength(1);
  });

  it('is a no-op when nothing actually changed', async () => {
    const res: any = await handler(patch({ title: RECIPE.title, ingredients: RECIPE.ingredients }));
    expect(res.statusCode).toBe(200);
    expect(commands('Put')).toHaveLength(0);
    expect(commands('Update')).toHaveLength(0);
  });

  it('lets a household member edit another member\'s recipe', async () => {
    mockVisibleOwnerIds.mockImplementation(async () => new Set(['owner-1', 'member-2']));
    const res: any = await handler(patch({ title: 'Theirs, tweaked' }, { sub: 'member-2', userId: 'owner-1' }));

    expect(res.statusCode).toBe(200);
    expect(commands('Put')[0].input.Item).toMatchObject({ userId: 'owner-1', changedBy: 'member-2' });
    expect(commands('Update')[0].input.Key).toEqual({ userId: 'owner-1', recipeId: 'r-1' });
  });

  it('refuses an edit to a recipe outside the caller\'s household', async () => {
    const res: any = await handler(patch({ title: 'Not mine' }, { sub: 'stranger', userId: 'owner-1' }));
    expect(res.statusCode).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('rejects an empty title, a bad url, and non-string lists', async () => {
    expect((await handler(patch({ title: '   ' })) as any).statusCode).toBe(400);
    expect((await handler(patch({ url: 'not a url' })) as any).statusCode).toBe(400);
    expect((await handler(patch({ ingredients: [1, 2] })) as any).statusCode).toBe(400);
    expect(commands('Update')).toHaveLength(0);
  });

  it('404s a soft-deleted recipe', async () => {
    existingItem = { ...RECIPE, deletedAt: '2026-02-01T00:00:00.000Z' };
    const res: any = await handler(patch({ title: 'Resurrect' }));
    expect(res.statusCode).toBe(404);
    expect(commands('Update')).toHaveLength(0);
  });
});
