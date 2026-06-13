# Recipator

iOS Share Extension and Chrome plugin for extracting and saving web recipes with AI.

## Stack

- **iOS** — Swift 5.10, SwiftUI, iOS 17+, XcodeGen (`ios/project.yml`)
- **Share Extension** — `com.apple.share-services`, receives URLs from Chrome/Safari share sheet
- **API** — API Gateway HTTP API + Lambda (Node 22), Cognito JWT authoriser (native, no authorizer Lambda)
- **Extraction** — schema.org/Recipe JSON-LD first; Claude Haiku (`claude-haiku-4-5-20251001`) fallback server-side
- **Storage** — DynamoDB `recipator-recipes-{env}` (userId PK, recipeId SK, TTL soft-delete)
- **Auth** — Shared Cognito user pool (`/nakomis-infra/{env}/cognito/user-pool-id`); iOS PKCE flow
- **Chrome extension** — planned

## Endpoints (sandbox)

`https://api.recipator.sandbox.nakomis.com`

| Method | Path | Description |
|---|---|---|
| POST | /extract | Fetch URL, extract recipe, save to DynamoDB |
| GET | /recipes | List user's recipes |
| GET | /recipes/{id} | Get one recipe |
| DELETE | /recipes/{id} | Soft delete (TTL 6 months) |
| POST | /failures | Report a capture failure |

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
