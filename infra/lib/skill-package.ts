import * as fs from 'fs';
import * as path from 'path';

// Per-environment staging of the Alexa skill package (RECIP-66).
//
// alexa/skill-package/ is the single source: an ASK CLI-shaped skill.json, the en-GB
// interaction model and the icons. The JSON carries three placeholder tokens that differ
// by environment — ${SKILL_NAME}, ${INVOCATION_NAME} and ${ENDPOINT_ARN} — so sandbox and
// prod can be installed side by side on the same Echo without their invocation names
// clashing ("ask sandbox recipator …" vs "ask recipator …").
//
// stageSkillPackage copies the whole package to outDir and fills the tokens in. The
// endpoint is passed in rather than looked up: the handler Lambda (RECIP-61) does not
// exist yet, and keeping this out of CDK means staging is offline and needs no deploy.
// Staged output goes under infra/build/ (gitignored); see defaultStageDir.

export type SkillEnv = 'sandbox' | 'prod';

export const SKILL_PACKAGE_DIR = path.join(__dirname, '../../alexa/skill-package');

export const SKILL_SETTINGS: Record<SkillEnv, { skillName: string; invocationName: string }> = {
  sandbox: { skillName: 'Recipator (sandbox)', invocationName: 'sandbox recipator' },
  prod: { skillName: 'Recipator', invocationName: 'recipator' },
};

export interface StageOptions {
  /** ARN of the skill's handler Lambda, written into the manifest endpoint. */
  endpointArn: string;
}

const LAMBDA_ARN = /^arn:aws:lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9_-]+(:[A-Za-z0-9_$-]+)?$/;

export function defaultStageDir(env: SkillEnv): string {
  return path.join(__dirname, '../build/skill-package', env);
}

/** Copies alexa/skill-package/ to outDir with this environment's values filled in. */
export function stageSkillPackage(env: SkillEnv, outDir: string, opts: StageOptions): void {
  const settings = SKILL_SETTINGS[env];
  if (!settings) throw new Error(`Unknown skill environment: ${env}`);
  if (!LAMBDA_ARN.test(opts.endpointArn)) {
    throw new Error(`endpointArn is not a Lambda function ARN: ${opts.endpointArn}`);
  }

  const tokens: Record<string, string> = {
    SKILL_NAME: settings.skillName,
    INVOCATION_NAME: settings.invocationName,
    ENDPOINT_ARN: opts.endpointArn,
  };

  // Start clean so files removed from the source don't linger in the staged copy.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(SKILL_PACKAGE_DIR, outDir, { recursive: true });

  for (const file of jsonFiles(outDir)) {
    const filled = fs.readFileSync(file, 'utf8').replace(/\$\{([A-Z_]+)\}/g, (match, name: string) => {
      if (!(name in tokens)) throw new Error(`Unknown token ${match} in ${path.relative(outDir, file)}`);
      return tokens[name];
    });
    JSON.parse(filled); // a value that broke the JSON would fail here, not at ASK upload
    fs.writeFileSync(file, filled);
  }
}

function jsonFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsonFiles(p);
    return entry.name.endsWith('.json') ? [p] : [];
  });
}
