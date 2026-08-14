import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addProvider } from "../models.js";
import {
  BUILTIN_CLIS,
  CLAUDE_CLI_BACKENDS,
  commandExists,
  specForAdapter,
  specForClaudeBackend,
} from "../cli.js";

export function registerAddProviderTool(server: McpServer): void {
  server.tool(
    "add_provider",
    "Add a new AI provider for brainstorming. Supports any OpenAI-compatible API, " +
      "or a locally installed agent CLI (kind='cli') that runs on an existing " +
      "subscription instead of API credits.",
    {
      name: z
        .string()
        .describe("Provider name, e.g. 'groq', 'ollama', 'mistral', 'claude'"),
      kind: z
        .enum(["api", "cli"])
        .optional()
        .describe(
          "'api' (default) for an OpenAI-compatible HTTP endpoint, 'cli' for a local agent CLI."
        ),
      defaultModel: z
        .string()
        .describe(
          "Default model for this provider, e.g. 'llama3', 'sonnet'. Use 'default' to let a CLI pick its own."
        ),
      baseURL: z
        .string()
        .optional()
        .describe("api only: base URL, e.g. 'http://localhost:11434/v1' for Ollama"),
      apiKeyEnvVar: z
        .string()
        .optional()
        .describe(
          "api only: environment variable holding the API key. Use 'NONE' if no key required."
        ),
      adapter: z
        .string()
        .optional()
        .describe(
          `cli only: built-in adapter — ${Object.keys(BUILTIN_CLIS).join(", ")} — or 'custom'. Defaults to the provider name.`
        ),
      backend: z
        .string()
        .optional()
        .describe(
          `cli only: run the Claude CLI against another vendor's coding plan — ${Object.keys(CLAUDE_CLI_BACKENDS).join(", ")}. Overrides 'adapter'.`
        ),
      command: z
        .string()
        .optional()
        .describe("cli only: executable to run. Required for adapter 'custom'."),
      args: z
        .array(z.string())
        .optional()
        .describe(
          "cli only ('custom' adapter): argv template. Placeholders: {{model}}, {{system}}, {{prompt}}, {{outfile}}."
        ),
      promptVia: z
        .enum(["arg", "stdin"])
        .optional()
        .describe("cli only ('custom' adapter): how the prompt reaches the CLI."),
    },
    { destructiveHint: false },
    async ({
      name,
      kind,
      baseURL,
      apiKeyEnvVar,
      defaultModel,
      adapter,
      backend,
      command,
      args,
      promptVia,
    }) => {
      try {
        if (kind === "cli") {
          const adapterId = backend
            ? "claude"
            : adapter || (BUILTIN_CLIS[name] ? name : "custom");

          let cli;
          if (backend) {
            cli = specForClaudeBackend(backend);
          } else if (adapterId === "custom") {
            if (!command || !args?.length) {
              throw new Error(
                "adapter 'custom' requires both 'command' and 'args'."
              );
            }
            cli = {
              adapter: "custom",
              command,
              args,
              promptVia: promptVia || ("arg" as const),
            };
          } else {
            cli = specForAdapter(adapterId, {
              ...(command ? { command } : {}),
              ...(promptVia ? { promptVia } : {}),
            });
          }

          addProvider({
            name,
            kind: "cli",
            baseURL: "",
            apiKeyEnvVar: "NONE",
            defaultModel,
            cli,
          });

          const installed = commandExists(cli.command);
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `CLI provider **${name}** added.\n\n` +
                  `- Adapter: ${adapterId}${backend ? ` (backend: ${backend})` : ""}\n` +
                  `- Command: \`${cli.command}\` (${installed ? "found on PATH" : "NOT FOUND on PATH"})\n` +
                  (backend
                    ? `- Endpoint: ${CLAUDE_CLI_BACKENDS[backend].baseURL} (token from ${CLAUDE_CLI_BACKENDS[backend].tokenEnv})\n`
                    : "") +
                  `- Default model: ${defaultModel}\n` +
                  `- Billing: your ${backend || name} subscription, not Anthropic API credits\n\n` +
                  `Use it as \`${name}:${defaultModel}\` in brainstorm calls.`,
              },
            ],
          };
        }

        if (!baseURL) {
          throw new Error("API providers require a baseURL.");
        }

        addProvider({
          name,
          kind: "api",
          baseURL,
          apiKeyEnvVar: apiKeyEnvVar || "NONE",
          defaultModel,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Provider **${name}** added successfully.\n\n` +
                `- Base URL: ${baseURL}\n` +
                `- Default model: ${defaultModel}\n` +
                `- API Key Env: ${apiKeyEnvVar || "NONE"}`,
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
