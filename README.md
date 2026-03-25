# brainstorm-mcp

[![npm](https://img.shields.io/npm/v/brainstorm-mcp)](https://www.npmjs.com/package/brainstorm-mcp)
[![IdeaCred](https://ideacred.com/api/badge/spranab/brainstorm-mcp)](https://ideacred.com/profile/spranab)

Multi-model AI brainstorming MCP server. Orchestrates debates between GPT, Gemini, DeepSeek, and Claude with structured synthesis. Includes instant quick mode, multi-model code review with verdicts, and red-team/Socratic styles. Hosted mode needs zero API keys.

**Don't trust one AI. Make them argue.**

## Features

- **Hosted mode** — No API keys needed. Uses models in your environment (Claude Opus/Sonnet/Haiku) via sub-agents
- **API mode** — Direct model API calls with parallel execution across OpenAI, Gemini, DeepSeek, Groq, Ollama
- **brainstorm_quick** — Instant multi-model perspectives in under 10 seconds
- **brainstorm_review** — Multi-model code review with structured findings, severity ratings, and verdicts
- **Debate styles** — Freeform, red-team (adversarial), and Socratic (probing questions)
- **Context injection** — Ground debates in actual code, diffs, or architecture docs
- **3-bullet synthesis verdicts** — Recommendation, Key Tradeoffs, Strongest Disagreement
- **Claude as participant** — Claude debates alongside external models with full conversation context
- **Multi-round debates** — Models see and critique each other's responses across rounds
- **Parallel execution** — All models respond concurrently within each round
- **Resilient** — One model failing doesn't abort the debate
- **Cross-platform** — Works on macOS, Windows, and Linux

## Installation

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "brainstorm": {
      "command": "npx",
      "args": ["-y", "brainstorm-mcp"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "GEMINI_API_KEY": "AIza...",
        "DEEPSEEK_API_KEY": "sk-..."
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

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

### Manual Install

```bash
npm install -g brainstorm-mcp
brainstorm-mcp
```

> **Hosted mode** requires no API keys — just install and go. The host (Claude Code) executes prompts using its own model access.

## Configuration

### Option 1: Environment Variables (simplest)

```
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
DEEPSEEK_API_KEY=sk-...
```

### Option 2: Config File (full control)

Set `BRAINSTORM_CONFIG` to point to a JSON config:

```json
{
  "providers": {
    "openai": { "model": "gpt-5.4", "apiKeyEnv": "OPENAI_API_KEY" },
    "gemini": { "model": "gemini-2.5-flash", "apiKeyEnv": "GEMINI_API_KEY" },
    "deepseek": { "model": "deepseek-chat", "apiKeyEnv": "DEEPSEEK_API_KEY" },
    "ollama": { "model": "llama3.1", "baseURL": "http://localhost:11434/v1" }
  }
}
```

Known providers (`openai`, `gemini`, `deepseek`, `groq`, `mistral`, `together`) don't need a `baseURL`.

## Tools

| Tool | Description | Annotation |
|------|-------------|------------|
| `brainstorm` | Multi-round debate between AI models (API or hosted mode) | readOnly |
| `brainstorm_quick` | Instant multi-model perspectives — parallel, no rounds | readOnly |
| `brainstorm_review` | Multi-model code review with findings, severity, verdict | readOnly |
| `brainstorm_respond` | Submit Claude's response in an interactive session | readOnly |
| `brainstorm_collect` | Submit model responses in a hosted session | readOnly |
| `list_providers` | Show configured providers and API key status | readOnly |
| `add_provider` | Add a new AI provider at runtime | non-destructive |

## Usage Examples

### Example 1: Quick Multi-Model Perspectives

**Prompt:** "Use brainstorm_quick to compare Redis vs PostgreSQL for session storage"

**Tool called:** `brainstorm_quick`
```json
{ "topic": "Redis vs PostgreSQL for session storage in a Node.js app" }
```

**Output:** Each configured model responds independently in parallel. You get a side-by-side comparison in under 10 seconds with model names, responses, timing, and cost.

**Error handling:** If a model fails (rate limit, timeout), the tool continues with remaining models and shows which ones failed.

---

### Example 2: Multi-Model Code Review

**Prompt:** "Review this diff for security issues" (with a git diff pasted)

**Tool called:** `brainstorm_review`
```json
{
  "diff": "diff --git a/src/auth.ts ...",
  "title": "Add JWT authentication middleware",
  "focus": ["security", "correctness"]
}
```

**Output:** A structured verdict (approve / approve with warnings / needs changes) with a findings table showing severity, category, file, line numbers, and suggestions. Includes model agreement analysis — issues flagged by multiple models have higher confidence.

**Error handling:** If synthesis fails, raw model reviews are still returned.

---

### Example 3: Hosted Mode Brainstorm (No API Keys)

**Prompt:** "Brainstorm using opus, sonnet, and haiku about whether we should use GraphQL or REST"

**Tool called:** `brainstorm`
```json
{
  "topic": "GraphQL vs REST for our public API",
  "models": ["opus", "sonnet", "haiku"],
  "mode": "hosted",
  "rounds": 2,
  "style": "redteam"
}
```

**Output:** The tool returns prompts for each model. The host (Claude Code) spawns sub-agents with different models, collects responses, and feeds them back via `brainstorm_collect`. After all rounds, a synthesis model produces a 3-bullet verdict: Recommendation, Key Tradeoffs, Strongest Disagreement.

**Error handling:** Sessions expire after 10 minutes. If a session is not found, a clear error message is returned with instructions to start a new one.

## How It Works

### API Mode
1. You ask Claude to brainstorm a topic
2. The tool sends the topic to all configured AI models in parallel
3. Claude reads their responses and contributes its own perspective
4. Models see each other's responses and refine across rounds
5. A synthesizer produces the final verdict

### Hosted Mode
1. You ask Claude to brainstorm with specific models (e.g., opus, sonnet, haiku)
2. The tool returns prompts — no API calls are made
3. Claude spawns sub-agents with different models to execute prompts
4. Responses are collected and fed back for the next round
5. Repeat until synthesis

## Privacy Policy

brainstorm-mcp runs entirely on your machine and does **not** collect, store, or transmit any personal data, telemetry, or analytics.

In **API mode**, prompts are sent directly from your machine to the model providers you configure (OpenAI, Gemini, DeepSeek, etc.) using your own API keys. In **hosted mode**, no external API calls are made.

Debate sessions are stored in-memory only with a 10-minute TTL. No data is written to disk unless you explicitly save results.

Full privacy policy: [PRIVACY.md](PRIVACY.md)

## Support

- **Issues**: https://github.com/spranab/brainstorm-mcp/issues
- **Email**: developer@pranab.co.in
- **Repository**: https://github.com/spranab/brainstorm-mcp

## Development

```bash
git clone https://github.com/spranab/brainstorm-mcp.git
cd brainstorm-mcp
npm install
npm run build
npm start
```

## License

MIT
