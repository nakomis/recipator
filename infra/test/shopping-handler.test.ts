// POST /shopping/items client-supplied itemId (RECP-49 B3). The offline sync re-pushes a
// create with the id the device minted, so the server must honour a valid id (idempotent
// overwrite) and otherwise mint its own. DynamoDB + cache are mocked — no AWS, no Bedrock call
// (a rules-matched item never reaches the LLM).

process.env.BEDROCK_MODEL_ID = 'test-model';

const mockPutItem = jest.fn(async (..._args: unknown[]) => {});
jest.mock('../lambda/shopping/store', () => ({
  DEFAULT_LIST_ID: 'default',
  ensureDefaultList: jest.fn(async () => {}),
  putItem: mockPutItem,
  listItems: jest.fn(),
  listLists: jest.fn(),
  getItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  clearTicked: jest.fn(),
  clearAll: jest.fn(),
  recordCorrection: jest.fn(),
}));

jest.mock('../lambda/shopping/category-cache', () => ({
  cacheGet: jest.fn(async () => null),
  cachePut: jest.fn(async () => {}),
}));

import { handler } from '../lambda/shopping';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function postItems(body: object, sub = 'user-1') {
  return {
    routeKey: 'POST /shopping/items',
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
  } as never;
}

describe('POST /shopping/items itemId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('honours a valid client-supplied itemId', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const res = (await handler(postItems({ text: 'milk', itemId: id }))) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(201);
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    expect((mockPutItem.mock.calls[0] as unknown[])[1]).toMatchObject({ itemId: id, aisle: 'dairy-eggs' });
    expect(JSON.parse(res.body).item.itemId).toBe(id);
  });

  it('mints a fresh uuid when the client id is missing or malformed', async () => {
    const res = (await handler(postItems({ text: 'milk', itemId: 'not-a-uuid' }))) as { statusCode: number };
    expect(res.statusCode).toBe(201);
    const stored = (mockPutItem.mock.calls[0] as unknown[])[1] as { itemId: string };
    expect(stored.itemId).toMatch(UUID_RE);
    expect(stored.itemId).not.toBe('not-a-uuid');
  });
});
