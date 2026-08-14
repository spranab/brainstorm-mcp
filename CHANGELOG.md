# Changelog

## 1.6.0

**CLI providers — debate on a subscription instead of API credits.**

A third transport alongside API and hosted mode. brainstorm can now shell out to agent CLIs
installed on your machine, so debates run on a plan you already pay for.

- Any supported CLI found on your `PATH` is registered automatically at startup — no configuration
  needed. Use it as `claude:sonnet`, `codex:default`, and so on.
- Built-in adapters: `claude` and `codex` (verified), plus `gemini`, `cursor-agent`, `opencode`,
  `qwen`, `kimi`, and `droid` (modelled on vendor docs — flags may need adjusting; `list_providers`
  and the startup log say which is which).
- `custom` adapter runs any other CLI from an argv template with `{{model}}`, `{{system}}`,
  `{{prompt}}`, and `{{outfile}}` placeholders.
- `backend` option points the Claude CLI at a vendor's Anthropic-compatible endpoint, so Moonshot
  (Kimi), MiniMax, and Z.ai (GLM) coding plans can join a debate. Tokens are read from the
  environment at call time and never stored in config.
- CLI calls run with tools disabled and a read-only sandbox where supported — they generate text,
  they don't touch your repo. Provider API-key env vars are stripped from the child process so the
  CLI falls back to subscription auth rather than billing credits.
- Cost estimates count CLI models as free: `~$0.0000 (2 of 3 via CLI subscriptions)`.

New env vars: `BRAINSTORM_CLI_PROVIDERS` (`auto` / `off` / adapter list), `BRAINSTORM_PREFER_CLI`,
`BRAINSTORM_CLI_TIMEOUT_MS`.

Also adds known base URLs and env-var detection for `moonshot`, `minimax`, `glm`, and `qwen` as
ordinary metered API providers.

`add_provider` accepts `kind: "cli"` with `adapter` / `backend` / `command` / `args`.
`list_providers` reports transport, verification status, and whether each CLI is on your PATH.

## 1.5.7

Raise the per-call timeout from 2 to 5 minutes — gpt-5.x reasoning models can run long on rich
prompts.

## 1.5.6

Drop `temperature` for gpt-5.x and o-series reasoning models, which reject any non-default value.

## 1.5.4 – 1.5.5

Add `mcpName` for the Official MCP Registry; packaging fixes.

## 1.5.3

Prepare for Anthropic MCP Directory submission.
