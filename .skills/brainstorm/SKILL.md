---
name: brainstorm
description: Run multi-round AI brainstorming debates between multiple LLM providers (GPT, DeepSeek, Groq, Ollama). Use when the user wants diverse perspectives, multi-model critiques, or synthesized answers from several AI models working together.
license: MIT
metadata:
  author: spranab
  version: "1.0.2"
---

# Brainstorm — Multi-Model AI Debates

Use the brainstorm-mcp tools to orchestrate structured debates between multiple LLMs. Models respond in parallel, see each other's answers across rounds, and a synthesizer produces a final consolidated output.

## When to Use

- User says "brainstorm this", "get multiple perspectives", "debate this topic"
- A question benefits from diverse viewpoints rather than a single model's answer
- User wants to compare how different models approach a problem
- Architecture decisions, trade-off analysis, or open-ended design questions

## Tools

| Tool | Description |
|------|-------------|
| `brainstorm` | Run a multi-round debate between configured AI models |
| `list_providers` | Show all configured providers, models, and API key status |
| `add_provider` | Dynamically add a new AI provider at runtime |

## Core Workflow

### Basic brainstorm
```
brainstorm({ topic: "Best architecture for a real-time collaborative app" })
```

### Targeted models with more rounds
```
brainstorm({
  topic: "React vs Vue for enterprise apps",
  models: ["openai:gpt-4o", "deepseek:deepseek-chat"],
  rounds: 5
})
```

### Custom synthesizer
```
brainstorm({
  topic: "Database strategy for 10M users",
  synthesizer: "openai:gpt-4o",
  systemPrompt: "Focus on scalability and cost trade-offs"
})
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `topic` | string | required | What to brainstorm about |
| `models` | string[] | all providers | Specific models as `provider:model` |
| `rounds` | number | 3 | Number of debate rounds (1-10) |
| `synthesizer` | string | first model | Model for final synthesis |
| `systemPrompt` | string | — | Custom system prompt for all models |

## How Debates Work

1. Topic is sent to all configured models in parallel
2. Each model responds independently (Round 1)
3. Models see each other's responses and refine their positions (Rounds 2-N)
4. A synthesizer model produces a final consolidated output
5. Results include per-round responses, the synthesis, and cost estimates

## Best Practices

- Use 2-3 rounds for quick opinions, 4-5 for deeper analysis
- Specify models explicitly when you want particular perspectives
- Use `systemPrompt` to focus the debate on specific aspects
- Check `list_providers` first to see which models are available
- One model failing won't abort the debate — results are resilient
