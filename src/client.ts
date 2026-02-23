import OpenAI from "openai";
import { ResolvedModel } from "./types.js";

const clientCache = new Map<string, OpenAI>();

export function getClient(model: ResolvedModel): OpenAI {
  const cacheKey = `${model.baseURL}::${model.apiKeyEnvVar}`;

  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const apiKey =
    model.apiKeyEnvVar === "NONE"
      ? "not-needed"
      : process.env[model.apiKeyEnvVar];

  if (!apiKey) {
    throw new Error(
      `Missing API key: environment variable ${model.apiKeyEnvVar} is not set. ` +
        `Configure it in your .mcp.json env section.`
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL: model.baseURL,
  });

  clientCache.set(cacheKey, client);
  return client;
}
