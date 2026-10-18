import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SKILL_PACKAGE_DIR, defaultStageDir, stageSkillPackage } from '../lib/skill-package';

const ARN = 'arn:aws:lambda:eu-west-2:975050268859:function:recipator-alexa-sandbox';
const readJson = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-package-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('source skill package', () => {
  const manifest = readJson(SKILL_PACKAGE_DIR, 'skill.json').manifest;
  const model = readJson(SKILL_PACKAGE_DIR, 'interactionModels/custom/en-GB.json').interactionModel.languageModel;

  it('is private, en-GB only and GB only', () => {
    const pub = manifest.publishingInformation;
    expect(pub.distributionMode).toBe('PRIVATE');
    expect(pub.isAvailableWorldwide).toBe(false);
    expect(pub.distributionCountries).toEqual(['GB']);
    expect(pub.category).toBe('SHOPPING');
    expect(Object.keys(pub.locales)).toEqual(['en-GB']);
  });

  it('references icons that exist at the expected names', () => {
    const locale = manifest.publishingInformation.locales['en-GB'];
    for (const uri of [locale.smallIconUri, locale.largeIconUri]) {
      expect(uri).toMatch(/^file:\/\/assets\/images\/en-GB_(small|large)IconUri\.png$/);
      expect(fs.existsSync(path.join(SKILL_PACKAGE_DIR, uri.replace('file://', '')))).toBe(true);
    }
  });

  it('defines the custom and built-in intents', () => {
    expect(model.intents.map((i: { name: string }) => i.name).sort()).toEqual([
      'AMAZON.CancelIntent',
      'AMAZON.FallbackIntent',
      'AMAZON.HelpIntent',
      'AMAZON.NavigateHomeIntent',
      'AMAZON.StopIntent',
      'AddItemIntent',
      'CheckOffItemIntent',
      'ReadListIntent',
    ]);
  });

  it('gives every free-text slot sample a carrier phrase', () => {
    for (const intent of model.intents) {
      const searchSlots = (intent.slots ?? [])
        .filter((s: { type: string }) => s.type === 'AMAZON.SearchQuery')
        .map((s: { name: string }) => `{${s.name}}`);
      for (const sample of intent.samples as string[]) {
        for (const slot of searchSlots) {
          if (!sample.includes(slot)) continue;
          // Alexa rejects a SearchQuery slot standing alone; there must be other words.
          expect(sample.replace(slot, '').trim()).not.toBe('');
        }
      }
    }
    const addItem = model.intents.find((i: { name: string }) => i.name === 'AddItemIntent');
    expect(addItem.slots).toEqual([{ name: 'item', type: 'AMAZON.SearchQuery' }]);
    expect(addItem.samples).toContain('add {item} to my list');
  });
});

describe('stageSkillPackage', () => {
  it.each([
    ['sandbox', 'sandbox recipator', 'Recipator (sandbox)'],
    ['prod', 'recipator', 'Recipator'],
  ] as const)('fills in %s values', (env, invocation, name) => {
    stageSkillPackage(env, tmp, { endpointArn: ARN });

    const manifest = readJson(tmp, 'skill.json').manifest;
    const locale = manifest.publishingInformation.locales['en-GB'];
    expect(manifest.apis.custom.endpoint.uri).toBe(ARN);
    expect(locale.name).toBe(name);
    expect(locale.examplePhrases[0]).toBe(`Alexa, ask ${invocation} to add milk to my list`);

    const model = readJson(tmp, 'interactionModels/custom/en-GB.json');
    expect(model.interactionModel.languageModel.invocationName).toBe(invocation);
  });

  it('leaves no unfilled tokens and copies the icons byte for byte', () => {
    stageSkillPackage('sandbox', tmp, { endpointArn: ARN });
    for (const f of ['skill.json', 'interactionModels/custom/en-GB.json']) {
      expect(fs.readFileSync(path.join(tmp, f), 'utf8')).not.toMatch(/\$\{/);
    }
    const icon = 'assets/images/en-GB_largeIconUri.png';
    expect(fs.readFileSync(path.join(tmp, icon))).toEqual(fs.readFileSync(path.join(SKILL_PACKAGE_DIR, icon)));
  });

  it('does not modify the source package', () => {
    const before = fs.readFileSync(path.join(SKILL_PACKAGE_DIR, 'skill.json'), 'utf8');
    stageSkillPackage('prod', tmp, { endpointArn: ARN });
    expect(fs.readFileSync(path.join(SKILL_PACKAGE_DIR, 'skill.json'), 'utf8')).toBe(before);
  });

  it('removes stale files from a previous staging', () => {
    fs.writeFileSync(path.join(tmp, 'stale.json'), '{}');
    stageSkillPackage('sandbox', tmp, { endpointArn: ARN });
    expect(fs.existsSync(path.join(tmp, 'stale.json'))).toBe(false);
  });

  it('rejects an endpoint that is not a Lambda ARN', () => {
    expect(() => stageSkillPackage('sandbox', tmp, { endpointArn: '${ENDPOINT_ARN}' })).toThrow(/not a Lambda/);
    expect(() => stageSkillPackage('sandbox', tmp, { endpointArn: 'https://example.com' })).toThrow(/not a Lambda/);
  });

  it('stages under infra/build/skill-package/{env} by default', () => {
    expect(defaultStageDir('sandbox')).toBe(path.resolve(__dirname, '../build/skill-package/sandbox'));
  });
});
