import { readFileSync } from "fs";
import { resolve } from "path";
import { CliSpec, ProviderConfig, ResolvedModel } from "./types.js";
import {
  AUTODETECT_ORDER,
  BUILTIN_CLIS,
  CLAUDE_CLI_BACKENDS,
  CLI_DEFAULT_MODEL,
  commandExists,
  specForAdapter,
  specForClaudeBackend,
} from "./cli.js";

const providers = new Map<string, ProviderConfig>();

// Known base URLs for common providers (used when not specified in config)
const KNOWN_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  moonshot: "https://api.moonshot.ai/v1",
  minimax: "https://api.minimax.io/v1",
  glm: "https://api.z.ai/api/paas/v4",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
};

const KNOWN_DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-5.4",
  deepseek: "deepseek-chat",
  gemini: "gemini-2.5-flash",
  moonshot: "kimi-k2-thinking",
  minimax: "MiniMax-M2",
  glm: "glm-4.6",
};

interface ConfigFileProvider {
  /** "cli" for a locally installed agent CLI, anything else = OpenAI-compatible API. */
  type?: string;
  model?: string;
  apiKeyEnv?: string;
  baseURL?: string;
  /** cli only: built-in adapter id, or "custom" with an args template. */
  adapter?: string;
  /** cli only: drive the `claude` binary against another vendor's endpoint. */
  backend?: string;
  command?: string;
  args?: string[];
  extraArgs?: string[];
  promptVia?: "arg" | "stdin";
  stripEnv?: string[];
  env?: Record<string, string>;
  usesOutputFile?: boolean;
  timeoutMs?: number;
  cwd?: string;
}

interface ConfigFile {
  providers: Record<string, ConfigFileProvider>;
}

/**
 * Load providers. Tries config file first, falls back to env vars.
 * Either way, locally installed agent CLIs are auto-detected afterwards
 * (unless BRAINSTORM_CLI_PROVIDERS=off) so a subscription can stand in for
 * API credits.
 *
 * Config file: brainstorm.config.json (or path in BRAINSTORM_CONFIG env var)
 * Env vars: OPENAI_API_KEY, OPENAI_DEFAULT_MODEL, etc.
 */
export function loadProviders(): void {
  const configPath =
    process.env.BRAINSTORM_CONFIG ||
    resolve(process.cwd(), "brainstorm.config.json");

  let loadedFromFile = false;

  // Try config file first
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config: ConfigFile = JSON.parse(raw);

    if (config.providers && typeof config.providers === "object") {
      for (const [name, p] of Object.entries(config.providers)) {
        if (p.type === "cli") {
          const cliProvider = buildCliProvider(name, p);
          if (cliProvider) providers.set(name, cliProvider);
          continue;
        }

        const baseURL =
          p.baseURL ||
          KNOWN_BASE_URLS[name] ||
          KNOWN_BASE_URLS[p.type || ""] ||
          "";

        if (!baseURL) {
          console.error(
            `[brainstorm] Skipping provider "${name}": no baseURL and not a known provider.`
          );
          continue;
        }

        if (!p.model) {
          console.error(
            `[brainstorm] Skipping provider "${name}": no default model configured.`
          );
          continue;
        }

        providers.set(name, {
          name,
          kind: "api",
          baseURL,
          apiKeyEnvVar: p.apiKeyEnv || "NONE",
          defaultModel: p.model,
        });
      }
      console.error(
        `[brainstorm] Loaded ${providers.size} provider(s) from ${configPath}`
      );
      loadedFromFile = true;
    }
  } catch {
    // Config file doesn't exist — fall back to env vars
  }

  if (!loadedFromFile) {
    console.error(
      "[brainstorm] No config file found, detecting providers from env vars"
    );
    loadFromEnvVars();
  }

  autodetectCliProviders();
}

function buildCliProvider(
  name: string,
  p: ConfigFileProvider
): ProviderConfig | undefined {
  // A backend runs the Claude CLI against another vendor's Anthropic-compatible
  // endpoint, so a coding-plan subscription stands in for that vendor's API.
  const backendName = p.backend || (CLAUDE_CLI_BACKENDS[name] ? name : undefined);
  if (backendName) {
    try {
      const cli = specForClaudeBackend(backendName);
      if (p.env) cli.env = { ...cli.env, ...p.env };
      if (p.extraArgs) cli.extraArgs = p.extraArgs;
      if (p.timeoutMs) cli.timeoutMs = p.timeoutMs;
      if (!commandExists(cli.command)) {
        console.error(
          `[brainstorm] CLI provider "${name}" needs the "${cli.command}" CLI, which is not on PATH.`
        );
      }
      return {
        name,
        kind: "cli",
        baseURL: "",
        apiKeyEnvVar: "NONE",
        defaultModel:
          p.model || CLAUDE_CLI_BACKENDS[backendName].defaultModel,
        cli,
      };
    } catch (err) {
      console.error(
        `[brainstorm] Skipping CLI provider "${name}": ${err instanceof Error ? err.message : String(err)}`
      );
      return undefined;
    }
  }

  const adapter = p.adapter || (BUILTIN_CLIS[name] ? name : "custom");

  const overrides: Partial<CliSpec> = {};
  if (p.env) overrides.env = p.env;
  if (p.command) overrides.command = p.command;
  if (p.args) overrides.args = p.args;
  if (p.extraArgs) overrides.extraArgs = p.extraArgs;
  if (p.promptVia) overrides.promptVia = p.promptVia;
  if (p.stripEnv) overrides.stripEnv = p.stripEnv;
  if (p.usesOutputFile !== undefined) overrides.usesOutputFile = p.usesOutputFile;
  if (p.timeoutMs) overrides.timeoutMs = p.timeoutMs;
  if (p.cwd) overrides.cwd = p.cwd;

  let cli: CliSpec;
  if (adapter === "custom") {
    if (!p.command || !p.args?.length) {
      console.error(
        `[brainstorm] Skipping CLI provider "${name}": custom adapter needs "command" and "args".`
      );
      return undefined;
    }
    cli = {
      adapter: "custom",
      command: p.command,
      args: p.args,
      promptVia: p.promptVia || "arg",
      extraArgs: p.extraArgs,
      stripEnv: p.stripEnv,
      env: p.env,
      usesOutputFile: p.usesOutputFile,
      timeoutMs: p.timeoutMs,
      cwd: p.cwd,
    };
  } else {
    try {
      cli = specForAdapter(adapter, overrides);
    } catch (err) {
      console.error(
        `[brainstorm] Skipping CLI provider "${name}": ${err instanceof Error ? err.message : String(err)}`
      );
      return undefined;
    }
  }

  if (!commandExists(cli.command)) {
    console.error(
      `[brainstorm] CLI provider "${name}" configured but "${cli.command}" is not on PATH — it will fail if used.`
    );
  }

  return {
    name,
    kind: "cli",
    baseURL: "",
    apiKeyEnvVar: "NONE",
    defaultModel:
      p.model || BUILTIN_CLIS[adapter]?.defaultModel || CLI_DEFAULT_MODEL,
    cli,
  };
}

/**
 * Register every known agent CLI found on PATH that the user has not already
 * configured explicitly. Opt out with BRAINSTORM_CLI_PROVIDERS=off, or narrow
 * to a subset with a comma-separated list of adapter ids.
 */
function autodetectCliProviders(): void {
  const setting = (process.env.BRAINSTORM_CLI_PROVIDERS || "auto").trim();
  if (setting.toLowerCase() === "off" || setting.toLowerCase() === "none") return;

  const wanted =
    setting.toLowerCase() === "auto"
      ? AUTODETECT_ORDER
      : setting.split(",").map((s) => s.trim()).filter(Boolean);

  const verified: string[] = [];
  const bestEffort: string[] = [];
  for (const adapter of wanted) {
    const builtin = BUILTIN_CLIS[adapter];
    if (!builtin) {
      console.error(`[brainstorm] Unknown CLI adapter "${adapter}" — skipping`);
      continue;
    }
    // An explicit config entry always wins over auto-detection.
    if (providers.has(adapter)) continue;
    if (!commandExists(builtin.command)) continue;

    providers.set(adapter, {
      name: adapter,
      kind: "cli",
      baseURL: "",
      apiKeyEnvVar: "NONE",
      defaultModel: builtin.defaultModel,
      cli: specForAdapter(adapter),
    });
    (builtin.verified ? verified : bestEffort).push(adapter);
  }

  if (!verified.length && !bestEffort.length) return;

  const parts: string[] = [];
  if (verified.length) parts.push(`${verified.join(", ")} (verified)`);
  // Best-effort adapters are registered too — their flags come from vendor docs
  // rather than a tested run, so say so instead of letting the first failure
  // be the user's introduction to them.
  if (bestEffort.length) {
    parts.push(`${bestEffort.join(", ")} (best-effort — flags unverified)`);
  }

  console.error(
    `[brainstorm] Detected CLI provider(s) on PATH: ${parts.join("; ")} — subscription-based, no API cost`
  );
}

function loadFromEnvVars(): void {
  const builtins = [
    { name: "openai", prefix: "OPENAI" },
    { name: "deepseek", prefix: "DEEPSEEK" },
    { name: "gemini", prefix: "GEMINI" },
    { name: "moonshot", prefix: "MOONSHOT" },
    { name: "minimax", prefix: "MINIMAX" },
    { name: "glm", prefix: "ZAI" },
  ];

  for (const b of builtins) {
    if (!process.env[`${b.prefix}_API_KEY`]) continue;

    providers.set(b.name, {
      name: b.name,
      kind: "api",
      baseURL:
        process.env[`${b.prefix}_BASE_URL`] || KNOWN_BASE_URLS[b.name] || "",
      apiKeyEnvVar: `${b.prefix}_API_KEY`,
      defaultModel:
        process.env[`${b.prefix}_DEFAULT_MODEL`] ||
        KNOWN_DEFAULT_MODELS[b.name] ||
        "",
    });
  }

  const extras = process.env.BRAINSTORM_EXTRA_PROVIDERS;
  if (!extras) return;

  for (const prefix of extras.split(",").map((s) => s.trim()).filter(Boolean)) {
    const name = prefix.toLowerCase();
    const baseURL = process.env[`${prefix}_BASE_URL`];
    const defaultModel = process.env[`${prefix}_DEFAULT_MODEL`];

    if (!baseURL || !defaultModel) {
      console.error(
        `[brainstorm] Skipping "${prefix}": need ${prefix}_BASE_URL and ${prefix}_DEFAULT_MODEL`
      );
      continue;
    }

    providers.set(name, {
      name,
      kind: "api",
      baseURL,
      apiKeyEnvVar: process.env[`${prefix}_API_KEY`]
        ? `${prefix}_API_KEY`
        : "NONE",
      defaultModel,
    });
  }
}

export function getProvider(name: string): ProviderConfig | undefined {
  return providers.get(name);
}

export function listProviders(): ProviderConfig[] {
  return Array.from(providers.values());
}

export function addProvider(config: ProviderConfig): void {
  if (providers.has(config.name)) {
    throw new Error(`Provider "${config.name}" already exists`);
  }
  providers.set(config.name, config);
}

export function getDefaultModels(): string[] {
  const all = Array.from(providers.values());

  // With BRAINSTORM_PREFER_CLI set, debates default to subscription-backed CLIs
  // and skip metered API providers entirely.
  const preferCli = /^(1|true|yes)$/i.test(
    process.env.BRAINSTORM_PREFER_CLI || ""
  );
  const cliOnly = all.filter((p) => p.kind === "cli");
  const chosen = preferCli && cliOnly.length ? cliOnly : all;

  return chosen.map((p) => `${p.name}:${p.defaultModel}`);
}

export function resolveModel(identifier: string): ResolvedModel {
  const colonIdx = identifier.indexOf(":");
  if (colonIdx === -1) {
    const available = listProviders()
      .map((p) => p.name)
      .join(", ");
    throw new Error(
      `Invalid format "${identifier}". Use "provider:model" (e.g. "openai:gpt-4o"). Available: ${available}`
    );
  }

  const providerName = identifier.slice(0, colonIdx);
  const modelId = identifier.slice(colonIdx + 1);

  if (!modelId) {
    throw new Error(`No model in "${identifier}". Use "provider:model" format.`);
  }

  const provider = getProvider(providerName);
  if (!provider) {
    const available = listProviders()
      .map((p) => p.name)
      .join(", ");
    throw new Error(
      `Unknown provider "${providerName}". Available: ${available}`
    );
  }

  return {
    provider: providerName,
    modelId,
    kind: provider.kind,
    baseURL: provider.baseURL,
    apiKeyEnvVar: provider.apiKeyEnvVar,
    cli: provider.cli,
  };
}

/** True when the identifier maps to a subscription-backed CLI (no API cost). */
export function isCliModel(identifier: string): boolean {
  const providerName = identifier.slice(0, identifier.indexOf(":"));
  return getProvider(providerName)?.kind === "cli";
}
