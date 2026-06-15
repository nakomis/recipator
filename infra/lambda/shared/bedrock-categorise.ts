// Bedrock/Haiku categorisation call (RECP-35) — the paid long-tail path injected into
// categorise() as `llmCategorise`. Constrains the model to the canonical aisle ids and
// asks for a clean item label that preserves distinguishing words.

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { AISLES } from './aisles';
import { log } from './logger';

const AISLE_LIST = AISLES.map((a) => `${a.id} (${a.label})`).join(', ');

function buildPrompt(itemText: string): string {
  return [
    'You sort UK supermarket shopping-list items into aisles.',
    `Given the item, respond with ONLY a JSON object: {"item":"…","aisle":"…"}.`,
    `"aisle" MUST be one of these ids: ${AISLES.map((a) => a.id).join(', ')}.`,
    `Aisle meanings: ${AISLE_LIST}.`,
    '"item" is a clean product name. PRESERVE distinguishing words — "double cream" and',
    '"single cream" are different items, do not collapse them to "cream". Do not include',
    'quantities in "item". If unsure of the aisle, use "other".',
    '',
    `Item: ${itemText}`,
  ].join('\n');
}

/** Build an `llmCategorise` function bound to a Bedrock client + model id. */
export function makeBedrockCategoriser(bedrock: BedrockRuntimeClient, modelId: string) {
  return async function llmCategorise(
    itemText: string,
  ): Promise<{ aisle: string; item?: string } | null> {
    let raw: string;
    try {
      const res = await bedrock.send(
        new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 200,
            messages: [{ role: 'user', content: buildPrompt(itemText) }],
          }),
        }),
      );
      const data = JSON.parse(new TextDecoder().decode(res.body)) as {
        content?: Array<{ text?: string }>;
      };
      raw = data.content?.[0]?.text ?? '';
    } catch (e) {
      log.error('categorise:bedrock_error', { itemText, error: String(e) });
      return null;
    }

    const text = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    try {
      const parsed = JSON.parse(text) as { item?: string; aisle?: string };
      if (!parsed.aisle) return null;
      return { aisle: parsed.aisle, item: parsed.item };
    } catch {
      log.warn('categorise:bedrock_parse_error', { itemText, raw });
      return null;
    }
  };
}
