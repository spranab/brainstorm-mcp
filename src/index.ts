#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerBrainstormTool } from "./tools/brainstorm.js";
import { registerBrainstormRespondTool } from "./tools/brainstorm-respond.js";
import { registerListProvidersTool } from "./tools/list-models.js";
import { registerAddProviderTool } from "./tools/add-model.js";
import { loadProviders } from "./models.js";

loadProviders();

const server = new McpServer({
  name: "brainstorm",
  version: "1.2.2",
});

registerBrainstormTool(server);
registerBrainstormRespondTool(server);
registerListProvidersTool(server);
registerAddProviderTool(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Brainstorm MCP server running on stdio");
