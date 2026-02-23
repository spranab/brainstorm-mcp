import { readFileSync } from "fs";
import { resolve } from "path";
import { ProviderConfig, ResolvedModel } from "./types.js";

const providers = new Map<string, ProviderConfig>();

// Known base URLs for common providers (used when not specified in config)
const KNOWN_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
};

const KNOWN_DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  deepseek: "deepseek-chat",
};

interface ConfigFileProvider {
  type?: string;
  model: string;
  apiKeyEnv?: string;
  baseURL?: string;
}

interface ConfigFile {
  providers: Record<string, ConfigFileProvider>;
}

/**
 * Load providers. Tries config file first, falls back to env vars.
 *
 * Config file: brainstorm.config.json (or path in BRAINSTORM_CONFIG env var)
 * Env vars: OPENAI_API_KEY, OPENAI_DEFAULT_MODEL, etc.
 */
export function loadProviders(): void {
  const configPath =
    process.env.BRAINSTORM_CONFIG ||
    resolve(process.cwd(), "brainstorm.config.json");

  // Try config file first
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config: ConfigFile = JSON.parse(raw);

    if (config.providers && typeof config.providers === "object") {
      for (const [name, p] of Object.entries(config.providers)) {
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

        providers.set(name, {
          name,
          baseURL,
          apiKeyEnvVar: p.apiKeyEnv || "NONE",
          defaultModel: p.model,
        });
      }
      console.error(
        `[brainstorm] Loaded ${providers.size} provider(s) from ${configPath}`
      );
      return;
    }
  } catch {
    // Config file doesn't exist — fall back to env vars
  }

  // Fallback: detect from env vars
  console.error(
    "[brainstorm] No config file found, detecting providers from env vars"
  );
  loadFromEnvVars();
}

function loadFromEnvVars(): void {
  const builtins = [
    { name: "openai", prefix: "OPENAI" },
    { name: "deepseek", prefix: "DEEPSEEK" },
  ];

  for (const b of builtins) {
    if (!process.env[`${b.prefix}_API_KEY`]) continue;

    providers.set(b.name, {
      name: b.name,
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
  return Array.from(providers.values()).map(
    (p) => `${p.name}:${p.defaultModel}`
  );
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
    baseURL: provider.baseURL,
    apiKeyEnvVar: provider.apiKeyEnvVar,
  };
}
