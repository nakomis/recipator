# Recipator

iOS Share Extension and Chrome plugin for extracting and saving web recipes with AI.

## Stack

- **iOS** — Swift 5.10, SwiftUI, iOS 17+, XcodeGen (`project.yml`)
- **Share Extension** — `com.apple.share-services`, receives URLs from Chrome/Safari share sheet
- **Extraction** — schema.org/Recipe JSON-LD first; Claude Haiku (`claude-haiku-4-5-20251001`) fallback
- **Storage (current)** — App Group `group.com.nakomis.recipator`, recipes as `.md` files
- **Storage (planned)** — AWS backend (API Gateway + Lambda + DynamoDB)
- **Chrome extension** — planned

## Apple Developer

- Team ID: `62YFUFBSFX`
- App bundle: `com.nakomis.recipator`
- Share Extension bundle: `com.nakomis.recipator.share`
- App Group: `group.com.nakomis.recipator`

## Project generation

```bash
brew install xcodegen   # one-time
xcodegen generate       # regenerates Recipator.xcodeproj
```

`*.xcodeproj` is generated on demand and **not committed** — source of truth is `project.yml`.

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
