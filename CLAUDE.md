# Recipator

iOS Share Extension and Chrome plugin for extracting and saving web recipes with AI.

## Stack

- **iOS** — Swift 5.10, SwiftUI, iOS 17+, XcodeGen (`ios/project.yml`)
- **Share Extension** — `com.apple.share-services`, receives URLs from Chrome/Safari share sheet
- **API** — API Gateway HTTP API + Lambda (Node 22), Cognito JWT authoriser (native, no authorizer Lambda)
- **Extraction** — schema.org/Recipe JSON-LD first; Claude Haiku (`claude-haiku-4-5-20251001`) fallback server-side via Amazon Bedrock (`eu.` inference profile; IAM, no API key)
- **Storage** — DynamoDB `recipator-recipes-{env}` (userId PK, recipeId SK, TTL soft-delete)
- **Auth** — Shared Cognito user pool (`/nakomis-infra/{env}/cognito/user-pool-id`); iOS PKCE flow
- **Chrome extension** — planned

## Endpoints (sandbox)

`https://api.recipator.sandbox.nakomis.com`

| Method | Path | Description |
|---|---|---|
| POST | /extract | Fetch URL, extract recipe, save to DynamoDB; async-invokes embed-Lambda |
| GET | /recipes | List user's recipes |
| GET | /recipes/{id} | Get one recipe |
| DELETE | /recipes/{id} | Soft delete (TTL 6 months) |
| POST | /failures | Report a capture failure |
| GET | /model | Presigned download URL + manifest for the on-device embedding model |
| GET | /embeddings | Search-index sync: recipe text (title/ingredients/method) + vector when embedded (`?all`) |

## Semantic search (RECP-19)

- **Model**: `mxbai-embed-large-v1` (1024-dim). Chosen by on-device speedrun + nDCG benchmark
  (see `experiments/`). Apple `NLEmbedding` was rejected (nDCG 0.116). Single combined
  **title + ingredients** embedding.
- **Server**: recipe vectors computed by an async Python container embed-Lambda
  (`infra/lambda/embed/`, sentence-transformers), stored as a DynamoDB Binary attribute
  (`embedding`, 1024 float32 LE). Verified identical to the on-device CoreML output.
- **Embed image (ECR)**: the embed Lambda is a container (torch + 1.3GB model ≫ 250MB ZIP
  limit), x86_64 (built natively by CI on x86 runners). The image is **not** built by
  `cdk deploy` — `infra/scripts/publish-embed-image.sh`
  builds + pushes it to the shared `nakomis-lambda-images` ECR repo (defined in nakomis-infra)
  under a content-hashed tag, and the stack references it with `DockerImageCode.fromEcr`. The
  push is idempotent: same `Dockerfile`/`requirements.txt`/`handler.py` → same tag → skipped.
  `pnpm run deploy-{env}` runs the publish step first, so a code change rebuilds and any redeploy
  is a no-op push. The tag is derived identically in bash and in `infra/lib/embed-image-tag.ts`.
- **Model delivery**: private S3 bucket `recipator-models-{env}`; app downloads via presigned
  `/model` URL on first launch, verifies sha256, compiles + warms up in the background
  (search disabled until ready). Publish a model with `infra/scripts/publish-model.sh`.
- **On-device**: GRDB store synced from `/embeddings` in the background. Two indexes:
  semantic (mxbai vectors, cosine) and **FTS5** keyword (title + ingredients + method).
  Query embedded on-device (`BertTokenizer` + `CoreMLEmbedder`, in `ios/Recipator/Search/`).
- **Hybrid ranking**: keyword (FTS) hits first, then semantically-similar recipes. Keyword
  search works as soon as text syncs (no model needed); semantic joins once the model lands.
  Method text is indexed too, so "I remember a step about X" searches work.
- **Model is swappable only before first deploy** — changing it later means re-embedding everything.

## Apple Developer

- Team ID: `62YFUFBSFX`
- App bundle: `com.nakomis.recipator`
- Share Extension bundle: `com.nakomis.recipator.share`
- App Group: `group.com.nakomis.recipator`

## Project generation

```bash
brew install xcodegen   # one-time
cd ios && xcodegen generate   # regenerates Recipator.xcodeproj
```

`*.xcodeproj` is generated on demand and **not committed** — source of truth is `project.yml`.

**Run `xcodegen generate` any time `ios/project.yml` changes** (after pulling). Xcode build phase scripts cannot call xcodegen reliably (it's not in Xcode's stripped PATH), so this step must be done manually. Signs that you need to regenerate: wrong Cognito domain in the login sheet, build settings referencing `$(VARIABLE)` literally, or missing targets/schemes.

## AWS credentials (future)

- Sandbox: `AWS_PROFILE=nakom.is-sandbox` (account `975050268859`)
- Production: `AWS_PROFILE=nakom.is-admin` (account `637423226886`)

## Taiga

Project prefix: **RECP** — tracked at `https://taiga.home.nakomis.com`.

## Architecture diagrams

Source: `docs/architecture/recipator.drawio` — SVG auto-regenerated on commit by `.githooks/pre-commit`.

To activate the hook after cloning:
```bash
git config core.hooksPath .githooks
```
