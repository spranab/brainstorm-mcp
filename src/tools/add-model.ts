import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addProvider } from "../models.js";

export function registerAddProviderTool(server: McpServer): void {
  server.tool(
    "add_provider",
    "Add a new AI provider for brainstorming. Supports any OpenAI-compatible API.",
    {
      name: z
        .string()
        .describe("Provider name, e.g. 'groq', 'ollama', 'mistral'"),
      baseURL: z
        .string()
        .describe("API base URL, e.g. 'http://localhost:11434/v1' for Ollama"),
      apiKeyEnvVar: z
        .string()
        .describe(
          "Environment variable name for the API key. Use 'NONE' if no key required."
        ),
      defaultModel: z
        .string()
        .describe("Default model to use for this provider, e.g. 'llama3', 'mixtral-8x7b-32768'"),
    },
    async ({ name, baseURL, apiKeyEnvVar, defaultModel }) => {
      try {
        addProvider({ name, baseURL, apiKeyEnvVar, defaultModel });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Provider **${name}** added successfully.\n\n` +
                `- Base URL: ${baseURL}\n` +
                `- Default model: ${defaultModel}\n` +
                `- API Key Env: ${apiKeyEnvVar}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
