# Phalanx Arena Frontend

The frontend is the browser-playable side of the repo. It renders the 3D battlefield, runs `engine-wasm` locally in the browser, reconstructs replays, can record replay videos, and can hand turns to browser AI.

For benchmark and tournament tooling, see [../backend/README.md](../backend/README.md).

## What Runs Here

- React 19 + Vite 8 app
- Three.js battlefield presentation and UI
- local `engine-wasm` game client
- replay import/reconstruction and video rendering
- strategos-1, strategos-2, and bring-your-own-key browser AI
- Cloudflare Worker/static-assets deployment path
- Cloudflare Durable Object room-code multiplayer

BYO-key mode is not a provider proxy: requests go from the browser to the selected provider.

## Local Development

From `frontend/`:

```powershell
npm install
npm run dev
```

`predev` runs `npm run build:engine-wasm`. If `wasm-pack` is installed, the script rebuilds `../engine/engine-wasm` into `src/generated/engine-wasm/`. If `wasm-pack` is missing and the committed generated bundle is complete, it reuses that bundle.

Useful scripts:

- `npm run build` - typecheck and build the static app.
- `npm run preview` - preview the production build.
- `npm run lint` - run ESLint.
- `npm run replay:video` - render replay JSON to WebM through Playwright/Chromium.
- `npm run deploy:cloudflare` - build in Cloudflare mode and deploy with Wrangler.

Generated artifact policy:

- `src/generated/engine-wasm/` is the committed browser/deploy fallback bundle.
- `node_modules/`, Vite output, Cloudflare output, and stale generated copies elsewhere are ignored.

## Browser AI

Launch the app normally, then use `AI Controls` to assign AI to one or both armies. The `AI Setup` panel has three modes:

- strategos-1: runs the bundled hybrid non-LLM policy entirely in the browser and requires no API key. The policy combines the trained action ranker in `src/simple-ai/model.classic_battle.json` with a small tactical planner, bounded general priors, and 1-ply local engine lookahead.
- strategos-2: runs the bundled browser neural policy in `src/simple-ai/neural-policy-v1/model.json` and requires no API key.
- Bring your own key: stores provider settings in `sessionStorage` and calls the provider directly from the browser.

BYO-key providers come from [../shared/aiProviderCatalog.json](../shared/aiProviderCatalog.json): `openai`, `anthropic`, `xai`, `mistral`, `gemini`, `together`, and `openrouter`.

BYO-key browser AI uses the benchmark-aligned `text_only` prompt flow by default. Browser-direct provider calls are subject to each provider's browser/CORS policy. Mistral browser-direct calls are throttled to a 20-second minimum interval per tab; set `localStorage["phalanx.mistralThrottleSeconds"]` to another number, or `0`, for diagnostics.

Retrain the strategos-1 model from backend replay data with `uv run phalanx-train-simple-ai`.

## Online Duels

The Cloudflare deployment includes room-code multiplayer through the same Worker that serves the app. `src/cloudflareWorker.js` routes `/phalanxarena/api/multiplayer/*` and `/api/multiplayer/*` to a `MatchRoom` Durable Object; each room owns one match, two private player tokens, and a WebSocket fanout.

The browser still renders and previews locally, but online actions are submitted to the room. The Durable Object runs the WASM engine, validates the active player's action, persists the replay action list, and broadcasts the next authoritative snapshot to both players.

Wrangler requires the `MATCH_ROOMS` Durable Object binding and migration in [wrangler.jsonc](wrangler.jsonc). Local Vite dev does not host Durable Objects; use `npx wrangler dev` when testing online rooms locally.

## Replays

The frontend can reconstruct game replays produced by the engine and by backend reports.

List replay payloads inside a benchmark or tournament file:

```powershell
npm run replay:video -- --input ..\backend\runs\full-tournament.json --list
```

Render one replay to WebM:

```powershell
npm run replay:video -- `
  --input ..\backend\runs\full-tournament.json `
  --replay-index 1 `
  --output ..\replay-videos\match-001.webm
```

The renderer opens hidden Chromium, drives the same 3D battlefield component, records the WebGL canvas, and writes a browser-supported video file. Install Chromium if needed:

```powershell
npx playwright install chromium
```

## Cloudflare Deployment

The Wrangler config is [wrangler.jsonc](wrangler.jsonc). It uses the public Worker name `phalanx-arena`, deploys to `workers.dev` by default, and points assets at `cloudflare-dist`.

Cloudflare builds use the `/phalanxarena/` base path, so a custom-domain deployment should route both `/phalanxarena` and `/phalanxarena/*` to the Worker. Add account-specific routes to `wrangler.jsonc` locally before deploying if you do not want to use the default workers.dev URL.

Deploy:

```powershell
npm run deploy:cloudflare
```

For another static host, use `npm run build` and serve the Vite output as a single-page app. strategos-1 and strategos-2 need only the static app assets; BYO-key provider calls still depend on each provider's browser/CORS policy.

## Key Files

- [src/main.tsx](src/main.tsx) - browser entry point.
- [src/App.tsx](src/App.tsx) - top-level app and UI state.
- [src/Battlefield3D.tsx](src/Battlefield3D.tsx) - 3D battlefield.
- [src/gameClient.ts](src/gameClient.ts) and [src/wasmGameClient.ts](src/wasmGameClient.ts) - local engine client.
- [src/multiplayerClient.ts](src/multiplayerClient.ts) - browser room-code multiplayer client.
- [src/browserAi.ts](src/browserAi.ts), [src/aiProviders.ts](src/aiProviders.ts), [src/aiOrchestrator.ts](src/aiOrchestrator.ts) - browser AI flow.
- [src/simpleAi.ts](src/simpleAi.ts) and [src/simple-ai/model.classic_battle.json](src/simple-ai/model.classic_battle.json) - strategos-1 scorer and model.
- [src/neuralPolicyAi.ts](src/neuralPolicyAi.ts) and [src/simple-ai/neural-policy-v1/model.json](src/simple-ai/neural-policy-v1/model.json) - strategos-2 scorer and model.
- [src/cloudflareWorker.js](src/cloudflareWorker.js) - Cloudflare asset Worker.
- [scripts/generate-replay-video.mjs](scripts/generate-replay-video.mjs) - replay video renderer.

## Verification

```powershell
npm run build
npm run lint
```
