import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { makeBedrockCategoriser } from '../lambda/shared/bedrock-categorise';

// A minimal fake Bedrock client: `send` returns whatever we queue, so we exercise the
// Converse response-parsing without hitting AWS.
function fakeBedrock(send: jest.Mock): BedrockRuntimeClient {
  return { send } as unknown as BedrockRuntimeClient;
}

function toolUseResponse(input: unknown) {
  return {
    output: { message: { content: [{ toolUse: { name: 'categorise_item', input } }] } },
  };
}

describe('makeBedrockCategoriser', () => {
  it('returns the structured tool-use input', async () => {
    const send = jest.fn().mockResolvedValue(toolUseResponse({ item: 'sauerkraut', aisle: 'world-foods' }));
    const llm = makeBedrockCategoriser(fakeBedrock(send), 'model-x');

    await expect(llm('sauerkraut')).resolves.toEqual({ item: 'sauerkraut', aisle: 'world-foods' });

    // Sanity-check the request shape: a forced tool with an enum-constrained aisle.
    const cmd = send.mock.calls[0][0].input;
    expect(cmd.toolConfig.toolChoice).toEqual({ tool: { name: 'categorise_item' } });
    const schema = cmd.toolConfig.tools[0].toolSpec.inputSchema.json;
    expect(schema.properties.aisle.enum).toContain('world-foods');
    expect(schema.properties.aisle.enum).toContain('other');
  });

  it('returns null when the model produced no tool use', async () => {
    const send = jest.fn().mockResolvedValue({ output: { message: { content: [{ text: 'hmm' }] } } });
    const llm = makeBedrockCategoriser(fakeBedrock(send), 'model-x');
    await expect(llm('mystery')).resolves.toBeNull();
  });

  it('returns null when the Bedrock call throws', async () => {
    const send = jest.fn().mockRejectedValue(new Error('throttled'));
    const llm = makeBedrockCategoriser(fakeBedrock(send), 'model-x');
    await expect(llm('anything')).resolves.toBeNull();
  });
});
