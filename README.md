# brainstorm-mcp

An MCP server that runs multi-round brainstorming debates between AI models. Connect it to Claude Code (or any MCP client) and let GPT, DeepSeek, Groq, Ollama, and others debate your ideas — then get a synthesized final output.

**No more single-perspective answers.** brainstorm-mcp pits multiple LLMs against each other so you get diverse viewpoints, critiques, and a consolidated synthesis.

## Features

- **Multi-round debates** — Models see and critique each other's responses across rounds
- **Parallel execution** — All models respond concurrently within each round
- **Per-model timeouts** — 2-minute timeout per API call, one slow model won't block others
- **Context truncation** — Automatically truncates history when approaching context limits
- **Cost estimation** — Shows estimated token usage and cost per debate
- **Resilient** — One model failing doesn't abort the debate
- **Synthesizer fallback** — If the primary synthesizer fails, tries other models
- **GPT-5.x / o3 / o4 compatible** — Automatically uses `max_completion_tokens` for newer OpenAI models
- **Cross-platform** — Works on macOS, Windows, and Linux

## How It Works

1. You ask Claude: *"Brainstorm the best architecture for a real-time app"*
2. The tool sends the topic to all configured AI models in parallel
3. Each model responds independently (Round 1)
4. Models see each other's responses and refine their positions (Rounds 2-N)
5. A synthesizer model produces a final consolidated output
6. You get back a structured debate with the synthesis

## Quick Start

### With Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "brainstorm": {
      "command": "npx",
      "args": ["-y", "brainstorm-mcp"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "DEEPSEEK_API_KEY": "sk-..."
      }
    }
  }
}
```

### With Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "brainstorm": {
      "command": "npx",
      "args": ["-y", "brainstorm-mcp"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "DEEPSEEK_API_KEY": "sk-..."
      }
    }
  }
}
```

### Manual install

```bash
npm install -g brainstorm-mcp
brainstorm-mcp
```

Then just ask Claude:

> *"Brainstorm the best way to handle authentication in a microservices architecture"*

## Configuration

### Option 1: Environment Variables (simplest)

Just set API keys as env vars — the server auto-detects providers:

```
OPENAI_API_KEY=sk-...
OPENAI_DEFAULT_MODEL=gpt-4o
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_DEFAULT_MODEL=deepseek-chat
GROQ_API_KEY=gsk_...
```

### Option 2: Config File (full control)

Set `BRAINSTORM_CONFIG` to point to a JSON config file:

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

Known providers (`openai`, `deepseek`, `groq`, `mistral`, `together`) don't need a `baseURL` — it's auto-detected.

| Field | Required | Description |
|-------|----------|-------------|
| `model` | Yes | Default model ID to use |
| `apiKeyEnv` | No | Environment variable name for the API key. Omit for local models (Ollama) |
| `baseURL` | No | API endpoint. Auto-detected for known providers |

## Tools

| Tool | Description |
|------|-------------|
| `brainstorm` | Run a multi-round debate between configured AI models |
| `list_providers` | Show all configured providers, models, and API key status |
| `add_provider` | Dynamically add a provider at runtime |

### `brainstorm` Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `topic` | string | required | What to brainstorm about |
| `models` | string[] | all providers | Specific models as `provider:model` |
| `rounds` | number | 3 | Number of debate rounds (1-10) |
| `synthesizer` | string | first model | Model for final synthesis |
| `systemPrompt` | string | — | Custom system prompt for all models |

## Usage Examples

### Basic brainstorm

> "Brainstorm the pros and cons of microservices vs monolith for a startup"

### Targeted models

> "Use brainstorm with models openai:gpt-4o and deepseek:deepseek-chat to debate whether React or Vue is better for enterprise apps"

### Deep dive with more rounds

> "Brainstorm with 5 rounds: what's the best database strategy for a social media app with 10M users?"

## Privacy Policy

brainstorm-mcp itself does not collect any user data. It acts as a proxy to the AI providers you configure. Your prompts and debate content are sent to the respective provider APIs (OpenAI, DeepSeek, Groq, etc.) according to their privacy policies. For local models (Ollama), all data stays on your machine.

## Development

```bash
git clone https://github.com/spranab/brainstorm-mcp.git
cd brainstorm-mcp
npm install
npm run build
npm start
```

## Support

- **Issues**: https://github.com/spranab/brainstorm-mcp/issues
- **Repository**: https://github.com/spranab/brainstorm-mcp

## License

MIT
