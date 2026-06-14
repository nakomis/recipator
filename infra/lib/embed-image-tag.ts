import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Content-hashed ECR tag for the embed Lambda container image.
//
// The tag is a hash of the build inputs, so it changes iff the image would change.
// publish-embed-image.sh pushes under this tag (skipping the build when it already
// exists), and the CDK stack references it with DockerImageCode.fromEcr — both derive
// it independently from the same files, so no handoff artifact is needed.
//
// MUST stay in lockstep with the equivalent computation in publish-embed-image.sh
// (verified byte-identical):
//   cat Dockerfile requirements.txt handler.py | shasum -a 256 | cut -c1-12
const EMBED_DIR = path.join(__dirname, '../lambda/embed');
const INPUTS = ['Dockerfile', 'requirements.txt', 'handler.py'];

export function embedImageTag(): string {
  const h = crypto.createHash('sha256');
  for (const f of INPUTS) h.update(fs.readFileSync(path.join(EMBED_DIR, f)));
  return `recipator-embed-${h.digest('hex').slice(0, 12)}`;
}
