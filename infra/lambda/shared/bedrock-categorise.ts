// Bedrock/Haiku categorisation call (RECP-35) — the paid long-tail path injected into
// categorise() as `llmCategorise`. Uses the Bedrock Converse API with a forced tool so the
// model returns a structured object whose `aisle` is constrained to the canonical ids by the
// tool's JSON schema (no prose-JSON scraping, no code-fence stripping). The aisle enum is
// generated from AISLES so it stays in lockstep with the taxonomy (RECP-36).

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { AISLES } from './aisles';
import { log } from './logger';

const AISLE_IDS = AISLES.map((a) => a.id);
const AISLE_MEANINGS = AISLES.map((a) => `${a.id} (${a.label})`).join(', ');

const TOOL_NAME = 'categorise_item';

// JSON schema for the tool input: `aisle` is enum-constrained to the canonical ids, so the
// model cannot return an off-menu aisle. `item` is a clean product label.
const TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    item: {
      type: 'string',
      description:
        'A clean product name with no quantities. PRESERVE distinguishing words — ' +
        '"double cream" and "single cream" are different items; do not collapse them to "cream".',
    },
    aisle: {
      type: 'string',
      enum: AISLE_IDS,
      description: `The supermarket aisle id. Meanings: ${AISLE_MEANINGS}. If unsure, use "other".`,
    },
  },
  required: ['item', 'aisle'],
};

/** Build an `llmCategorise` function bound to a Bedrock client + model id. */
export function makeBedrockCategoriser(bedrock: BedrockRuntimeClient, modelId: string) {
  return async function llmCategorise(
    itemText: string,
  ): Promise<{ aisle: string; item?: string } | null> {
    try {
      const res = await bedrock.send(
        new ConverseCommand({
          modelId,
          messages: [
            {
              role: 'user',
              content: [
                {
                  text:
                    'Sort this UK supermarket shopping-list item into an aisle and give a ' +
                    `clean product name. Use the ${TOOL_NAME} tool.\n\nItem: ${itemText}`,
                },
              ],
            },
          ],
          inferenceConfig: { maxTokens: 200 },
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: TOOL_NAME,
                  description: 'Record the aisle and clean name for a shopping-list item.',
                  inputSchema: { json: TOOL_INPUT_SCHEMA },
                },
              },
            ],
            // Force the tool so the model must return structured args, not prose.
            toolChoice: { tool: { name: TOOL_NAME } },
          },
        }),
      );

      const toolUse = res.output?.message?.content?.find((b) => b.toolUse)?.toolUse;
      const input = toolUse?.input as { item?: string; aisle?: string } | undefined;
      if (!input?.aisle) {
        log.warn('categorise:bedrock_no_tool_use', { itemText });
        return null;
      }
      return { aisle: input.aisle, item: input.item };
    } catch (e) {
      log.error('categorise:bedrock_error', { itemText, error: String(e) });
      return null;
    }
  };
}
