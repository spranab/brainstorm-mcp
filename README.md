# brainstorm-mcp

An MCP server that runs multi-round brainstorming debates between AI models. Connect it to Claude Code (or any MCP client) and let GPT, DeepSeek, Groq, Ollama, and others debate your ideas — then get a synthesized final output.

## How it works

1. You ask Claude: *"Brainstorm the best architecture for a real-time app"*
2. The tool sends the topic to all configured AI models in parallel
3. Each model responds independently (Round 1)
4. Models see each other's responses and refine their positions (Rounds 2-N)
5. A synthesizer model produces a final consolidated output
6. You get back a structured debate with the synthesis

## Quick Start

```bash
# Clone and build
git clone https://github.com/AIPoweredSolutions/brainstorm-mcp.git
cd brainstorm-mcp
npm install
npm run build
```

### Configure providers

Copy the example config and add your API keys:

```bash
cp brainstorm.config.example.json brainstorm.config.json
```

Edit `brainstorm.config.json`:

```json
{
  "providers": {
    "openai": {
      "model": "gpt-4o",
      "apiKeyEnv": "OPENAI_API_KEY"
    },
    "deepseek": {
      "model": "deepseek-chat",
      "apiKeyEnv": "DEEPSEEK_API_KEY"
    }
  }
}
```

### Connect to Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "brainstorm": {
      "command": "node",
      "args": ["/path/to/brainstorm-mcp/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "DEEPSEEK_API_KEY": "sk-...",
        "BRAINSTORM_CONFIG": "/path/to/brainstorm.config.json"
      }
    }
  }
}
```

Restart Claude Code, then just ask:

> *"Brainstorm the best way to handle authentication in a microservices architecture"*

## Configuration

### brainstorm.config.json

The config file defines AI providers. Known providers (`openai`, `deepseek`, `groq`, `mistral`, `together`) don't need a `baseURL` — it's auto-detected.

```json
{
  "providers": {
    "openai": {
      "model": "gpt-4o",
      "apiKeyEnv": "OPENAI_API_KEY"
    },
    "deepseek": {
      "model": "deepseek-chat",
      "apiKeyEnv": "DEEPSEEK_API_KEY"
    },
    "groq": {
      "model": "llama-3.3-70b-versatile",
      "apiKeyEnv": "GROQ_API_KEY"
    },
    "ollama": {
      "model": "llama3.1",
      "baseURL": "http://localhost:11434/v1"
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `model` | Yes | Default model ID to use |
| `apiKeyEnv` | No | Environment variable name for the API key. Omit for local models (Ollama) |
| `baseURL` | No | API endpoint. Auto-detected for known providers |

### Fallback: Environment Variables

If no config file exists, the server detects providers from env vars:

```
OPENAI_API_KEY=sk-...
OPENAI_DEFAULT_MODEL=gpt-4o
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_DEFAULT_MODEL=deepseek-chat
```

## MCP Tools

### `brainstorm`

Run a multi-round debate. Only `topic` is required — everything else has sensible defaults.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `topic` | string | required | What to brainstorm about |
| `models` | string[] | all providers | Specific models as `provider:model` |
| `rounds` | number | 3 | Number of debate rounds (1-10) |
| `synthesizer` | string | first model | Model for final synthesis |
| `systemPrompt` | string | — | Custom system prompt |

### `list_providers`

Shows all configured providers, their default models, and API key status.

### `add_provider`

Dynamically add a provider at runtime.

## Features

- **Multi-round debates** — Models see and critique each other's responses
- **Parallel execution** — All models respond concurrently within each round
- **Per-model timeouts** — 2-minute timeout per API call, one slow model won't block others
- **Context truncation** — Automatically truncates history when approaching context limits
- **Cost estimation** — Shows estimated token usage and cost
- **Resilient** — One model failing doesn't abort the debate
- **Synthesizer fallback** — If the primary synthesizer fails, tries other models
- **GPT-5.x / o3 / o4 compatible** — Automatically uses `max_completion_tokens` for newer OpenAI models

## License

MIT
