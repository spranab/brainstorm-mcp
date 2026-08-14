import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listProviders } from "../models.js";
import { BUILTIN_CLIS, commandExists } from "../cli.js";

export function registerListProvidersTool(server: McpServer): void {
  server.tool(
    "list_providers",
    "List all configured AI providers and their default models for brainstorming. " +
      "Includes locally installed agent CLIs (claude, codex, ...) which run on an " +
      "existing subscription instead of metered API credits.",
    {},
    { readOnlyHint: true },
    async () => {
      const providers = listProviders();

      if (!providers.length) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "## Configured Providers\n\nNone. Set an API key (e.g. `OPENAI_API_KEY`), " +
                "add a `brainstorm.config.json`, or install an agent CLI such as " +
                "`claude` or `codex` to use a subscription instead of API credits.",
            },
          ],
        };
      }

      const lines = providers.map((p) => {
        if (p.kind === "cli") {
          const cmd = p.cli?.command || p.name;
          const installed = commandExists(cmd);
          const builtin = BUILTIN_CLIS[p.cli?.adapter || ""];
          const note = builtin?.note;
          const status = builtin
            ? builtin.verified
              ? " — verified"
              : " — best-effort"
            : "";
          const backendURL = p.cli?.env?.ANTHROPIC_BASE_URL;
          const tokenRef = p.cli?.env?.ANTHROPIC_AUTH_TOKEN;
          const tokenSet =
            !tokenRef ||
            !tokenRef.startsWith("$") ||
            !!process.env[tokenRef.slice(1)];
          return (
            `- **${p.name}** (CLI, subscription${status}) → default model: \`${p.defaultModel}\`\n` +
            `  Command: \`${cmd}\` — ${installed ? "found on PATH" : "NOT FOUND on PATH"}` +
            (backendURL
              ? `\n  Backend: ${backendURL}` +
                (tokenSet ? "" : ` — token MISSING (${tokenRef!.slice(1)})`)
              : "") +
            (note ? `\n  Note: ${note}` : "")
          );
        }

        const keySet = p.apiKeyEnvVar === "NONE" || !!process.env[p.apiKeyEnvVar];
        return (
          `- **${p.name}** (API) → default model: \`${p.defaultModel}\`\n` +
          `  API key: ${keySet ? "configured" : "MISSING (" + p.apiKeyEnvVar + ")"}`
        );
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `## Configured Providers\n\n${lines.join("\n\n")}`,
          },
        ],
      };
    }
  );
}
