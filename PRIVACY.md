# Privacy Policy

**brainstorm-mcp** is a local MCP server that runs entirely on your machine.

## Data Collection

brainstorm-mcp does **not** collect, store, or transmit any personal data, telemetry, or analytics.

## Data Flow

When using **API mode**, brainstorm-mcp sends your prompts to the external model providers you configure (OpenAI, Google Gemini, DeepSeek, etc.). These requests are made directly from your machine to the provider APIs using your own API keys. brainstorm-mcp does not proxy, log, or intercept these requests.

When using **hosted mode**, brainstorm-mcp does not make any external API calls. All prompts are returned to the host application (Claude Code, Copilot, etc.) for execution.

## Data Storage

- Debate sessions are stored **in-memory only** with a 10-minute TTL. No data is written to disk unless you explicitly save results.
- Configuration files (API keys, provider settings) are stored locally in your project directory.
- No data is sent to any server operated by the brainstorm-mcp authors.

## Third-Party Services

brainstorm-mcp connects only to the model providers you explicitly configure. Each provider has its own privacy policy:
- [OpenAI Privacy Policy](https://openai.com/privacy)
- [Google Gemini Privacy Policy](https://ai.google.dev/terms)
- [DeepSeek Privacy Policy](https://www.deepseek.com/privacy)

## Contact

For privacy questions, contact: developer@pranab.co.in
