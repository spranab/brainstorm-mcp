import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listProviders } from "../models.js";

export function registerListProvidersTool(server: McpServer): void {
  server.tool(
    "list_providers",
    "List all configured AI providers and their default models for brainstorming.",
    {},
    async () => {
      const providers = listProviders();
      const lines = providers.map((p) => {
        const keySet = p.apiKeyEnvVar === "NONE" || !!process.env[p.apiKeyEnvVar];
        return (
          `- **${p.name}** → default model: \`${p.defaultModel}\`\n` +
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
