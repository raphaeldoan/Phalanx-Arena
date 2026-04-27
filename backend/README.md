# Phalanx Arena Backend

The backend package owns the Python headless benchmark harness, tournament runner, provider orchestration, and report generation. It talks to the Rust rules engine through `engine-cli`; if no usable CLI binary is found, the runtime attempts `cargo build -p engine-cli`.

For the browser game, see [../frontend/README.md](../frontend/README.md).

## Commands

- `phalanx-headless-benchmark` - run a match series between two model configurations.
- `phalanx-headless-tournament` - run a `classic_battle` round robin over a model roster.

## Setup

Requirements:

- Python 3.11+
- `uv`
- Rust toolchain

From `backend/`:

```powershell
uv sync --group dev
```

Provider defaults come from [../shared/aiProviderCatalog.json](../shared/aiProviderCatalog.json):

- `openai` -> `OPENAI_API_KEY`
- `anthropic` -> `ANTHROPIC_API_KEY`
- `xai` -> `XAI_API_KEY`
- `mistral` -> `MISTRAL_API_KEY`
- `gemini` -> `GEMINI_API_KEY`
- `together` -> `TOGETHER_API_KEY`
- `openrouter` -> `OPENROUTER_API_KEY`

Useful environment overrides:

- `PHALANX_ENGINE_CLI_PATH` points at a specific `engine-cli` binary.
- `PHALANX_AI_MODEL_PRICING_JSON` adds or replaces model pricing entries.
- `PHALANX_MISTRAL_THROTTLE_SECONDS` or `PHALANX_MISTRAL_MIN_REQUEST_INTERVAL_SECONDS` overrides the default 20-second Mistral request interval; set to `0` only for local diagnostics.

Pricing override shape:

```json
{"model-name":{"input_usd_per_1m":0.25,"cached_input_usd_per_1m":0.025,"output_usd_per_1m":2.0}}
```

When a model has no configured price, reports keep token usage and leave cost fields blank.

## Headless Benchmark

From `backend/`:

```powershell
uv run phalanx-headless-benchmark `
  --scenario classic_battle `
  --games 10 `
  --seed-start 7 `
  --model-a openai/gpt-5.5 `
  --provider-a openrouter `
  --model-b anthropic/claude-opus-4.7 `
  --provider-b openrouter `
  --output headless-benchmark.json
```

The runner orchestrates provider HTTP calls from Python, simulates turns through `engine-cli`, uses the strict `text_only` benchmark profile, and writes JSON with winners, usage, costs, and replay payloads.

## Tournament Runner

The tournament runner is fixed to `classic_battle`. One seed pair is four games: both model-to-army assignments under both A-first and B-first setup roles. The default is `--seed-pairs 3`.

The canonical roster is [tournament-roster.json](tournament-roster.json). It currently contains five flagship models plus two small-model baselines, all routed through `openrouter`.

Run the canonical roster:

```powershell
uv run phalanx-headless-tournament `
  --roster .\tournament-roster.json `
  --seed-pairs 3 `
  --seed-start 7 `
  --live-logs `
  --output .\runs\full-tournament.json
```

Run a quick inferred-provider smoke tournament:

```powershell
uv run phalanx-headless-tournament `
  --model gpt-5.4-mini `
  --model claude-opus-4-6 `
  --model gemini-2.5-flash `
  --seed-pairs 1 `
  --seed-start 7 `
  --live-logs `
  --output .\runs\smoke-tournament.json
```

Phased runs can skip pairings by exact label or provider. Because the canonical roster uses `openrouter` for every competitor, use label skips for model-specific phases:

```powershell
uv run phalanx-headless-tournament `
  --roster .\tournament-roster.json `
  --skip-label "Claude Opus 4.7" `
  --skip-label "Grok 4.20 Reasoning" `
  --seed-pairs 2 `
  --seed-start 7 `
  --live-logs `
  --output .\runs\classic-battle-tournament-smoke.json
```

Fill omitted pairings later by removing the skip filter and resuming against the same output:

```powershell
uv run phalanx-headless-tournament `
  --roster .\tournament-roster.json `
  --seed-pairs 2 `
  --seed-start 7 `
  --live-logs `
  --resume `
  --output .\runs\classic-battle-tournament-smoke.json
```

Before spending on a full roster, run a same-model side-bias audit:

```powershell
uv run phalanx-headless-tournament `
  --side-bias-model openai/gpt-5.5 `
  --side-bias-provider openrouter `
  --side-bias-label "OpenAI GPT-5.5" `
  --seed-pairs 3 `
  --seed-start 7 `
  --live-logs `
  --output .\runs\side-bias-gpt-5.5.json
```

Useful controls:

- `--jobs` parallelizes whole pairings.
- `--match-jobs` parallelizes matches inside each pairing.
- `--with-rationale` asks for a short rationale alongside the selected action.
- `--log-decisions` streams individual model decisions when `--live-logs` is set.
- `--battle-report-dir` writes per-battle reports even without `--output`, or overrides the default sibling report directory.

`--jobs` and `--match-jobs` multiply: `--jobs 2 --match-jobs 2` can run up to four matches concurrently.

## Benchmark Design

- strict `text_only` prompts
- shared output cap across providers
- deterministic settings where supported
- hidden/simultaneous deployment collection
- local `SELF` / `ENEMY` view where `SELF` advances toward lower `y`
- role-complete seed pairs so every model plays both armies and both setup roles

Scoring:

- win = `1`, draw = `0.5`, loss = `0`
- unfinished games remain flagged and count as `0.5 / 0.5`
- seed-pair winner is decided by total game points
- pairing winner is decided by seed-pair wins, then total game points
- leaderboard ranks by total game points, head-to-head game points, head-to-head seed-pair wins, then fewer unfinished games
- battle-score differential is diagnostic only

## Output And Resume

With `--output`, the runner writes the tournament JSON immediately so `--resume` has stable metadata. Partial pairing progress is checkpointed after each completed match; a resumed run reuses saved matches. Pairings omitted with `--skip-label` or `--skip-provider` remain absent from the snapshot, so a later resume without the skip runs only omitted pairings.

When `--output` is set, per-battle reports default to a sibling `<output stem>-battle-reports/` directory. Each report folder includes `state-summary.json`; tournament match entries include `battle_report_path` after reports are written, and the top-level payload records `battle_reports_dir`.

Run artifacts:

- ad hoc output under `backend/runs/` is ignored
- the public result [runs/full-tournament.json](runs/full-tournament.json) and per-battle `state-summary.json` files under `runs/full-tournament-battle-reports/` are allowlisted
- chart PNGs under `runs/charts/` are also allowlisted when generated
- if a new run becomes public, give it a clear path and update `.gitignore`

Do not commit provider credentials or private run logs. Use the repository-level [.env.example](../.env.example) as the public template for local environment variables.

## Verification

From `backend/`:

```powershell
uv run pytest
```

From the repo root:

```powershell
cargo build -p engine-cli
```
