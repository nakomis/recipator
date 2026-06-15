# Recipator web app

React SPA companion to the Recipator iOS app and Chrome extension — sign in with
Cognito and browse, search, view, save and delete your recipes in the browser.
Served from S3 + CloudFront at `recipator[.sandbox].nakomis.com`.

## Stack

| Concern | Tool |
|---------|------|
| Build / dev server | **Vite 8** |
| Framework | **React 19** |
| Routing | **TanStack Router** |
| Data fetching | **TanStack Query** over a plain `fetch` client (`src/api/client.ts`) |
| Auth | **react-oidc-context** → shared Cognito user pool (auth-code + PKCE) |
| Language | **TypeScript 6** (`strict`) |
| Styling | **Tailwind CSS v4** + **shadcn/ui** (One Dark theme, dark by default) |
| Tests | **Vitest 4** + Testing Library (jsdom), 70% line gate |
| Lint / format | **Biome 2** |
| Package manager | **pnpm** (pinned via `packageManager`) |

## Commands

```bash
pnpm install                       # install deps
bash scripts/set-config.sh localhost   # fill config.json from sandbox SSM, redirect → localhost:3000
pnpm dev                           # Vite dev server (http://localhost:3000)
pnpm build                         # tsc -b + vite build → dist/
pnpm test                          # Vitest + coverage
pnpm lint / pnpm typecheck         # Biome / tsc
```

> `scripts/set-config.sh {localhost|sandbox|prod}` overwrites `src/config/config.json`
> from AWS SSM (Cognito + API URL) before a build. The committed `config.json` holds
> `<PLACEHOLDER>` tokens so the repo type-checks/builds without AWS.

## How it works

1. `react-oidc-context` runs the Cognito hosted-login auth-code/PKCE flow; the redirect
   lands on `/loggedin` which bounces home. `<AuthTokenSync>` keeps the access token in a
   module-scoped holder so `src/api/client.ts` can attach `Authorization: Bearer …` to
   every request.
2. The app reuses the **existing `RecipatorClient`** Cognito client (same as iOS/extension)
   — the SPA's callback/logout URLs and the API CORS origin are added in `infra`.
3. **Search** is client-side keyword matching (`src/lib/search.ts`) over `GET /embeddings`
   (title + ingredients + method) — mirrors the iOS FTS index. Semantic/vector search is
   deferred (it needs an on-device model or a server query-embed endpoint).
4. **Save by URL** calls `POST /extract`. The server fetches the page itself, so
   Cloudflare-protected sites may fail in the browser (the iOS app / extension get past
   those by sending the rendered page HTML).

## Deployment

`cdk deploy` (in `../infra`) provisions the S3 bucket + CloudFront distribution and
publishes their ids to SSM. CI then builds and uploads:

```
set-config.sh $ENV  →  pnpm build  →  aws s3 sync dist/ s3://$BUCKET --delete  →  CloudFront invalidation
```

See `../infra/lib/web-stack.ts`, `web-cert-stack.ts`, and the `deploy-web-*` jobs in
`.github/workflows/ci.yml`. Prod stays behind the gated `production` environment.

## Conventions

- **`@/` aliases `src/`**. `src/components/ui/**` are vendored shadcn primitives — added via
  `pnpm dlx shadcn@latest add <name>`, not hand-edited (Biome + coverage skip them).
- **Dark by default** (`<html class="dark">`); theme tokens in `src/index.css`.
- pnpm keeps `pnpm-lock.yaml` registry-agnostic so the same lockfile installs from the home
  Nexus proxy locally and from npmjs in CI.
