---
name: brainstorm
description: Run multi-round AI brainstorming debates between multiple LLM providers (GPT, DeepSeek, Groq, Ollama). Claude actively participates as a debater alongside external models. Use when the user wants diverse perspectives, multi-model critiques, or synthesized answers from several AI models working together.
license: MIT
metadata:
  author: spranab
  version: "1.1.0"
---

# Brainstorm — Multi-Model AI Debates

Use the brainstorm-mcp tools to orchestrate structured debates between multiple LLMs. By default, Claude participates as an active debater alongside external models — reading their responses, pushing back, building on ideas, and refining its position across rounds.

## When to Use

- User says "brainstorm this", "get multiple perspectives", "debate this topic"
- A question benefits from diverse viewpoints rather than a single model's answer
- User wants to compare how different models approach a problem
- Architecture decisions, trade-off analysis, or open-ended design questions

## Tools

| Tool | Description |
|------|-------------|
| `brainstorm` | Run a multi-round debate between configured AI models |
| `brainstorm_respond` | Submit Claude's response for the current round of an interactive session |
| `list_providers` | Show all configured providers, models, and API key status |
| `add_provider` | Dynamically add a new AI provider at runtime |

## Core Workflow (Interactive Mode — Default)

### 1. Start the debate
```
brainstorm({ topic: "Best architecture for a real-time app", rounds: 3 })
```
Returns round 1 external model responses + a session_id.

### 2. Respond each round
Read the external models' responses, form your own position, then call:
```
brainstorm_respond({ session_id: "<id>", response: "Your substantive contribution..." })
```
This stores your response and runs the next external round. Repeat until all rounds complete.

### 3. Synthesis
After the final round response, synthesis runs automatically and returns the full debate.

## Non-Interactive Mode

For debates between external models only (no Claude participation):
```
brainstorm({ topic: "React vs Vue", participate: false })
```

## Parameters

### `brainstorm`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `topic` | string | required | What to brainstorm about |
| `models` | string[] | all providers | Specific models as `provider:model` |
| `rounds` | number | 3 | Number of debate rounds (1-10) |
| `synthesizer` | string | first model | Model for final synthesis |
| `systemPrompt` | string | — | Custom system prompt for all models |
| `participate` | boolean | true | Whether Claude joins as an active debater |

### `brainstorm_respond`

| Parameter | Type | Description |
|-----------|------|-------------|
| `session_id` | string | Session ID from the brainstorm tool |
| `response` | string | Claude's contribution (min 50 chars) |

## Best Practices

- Use 2-3 rounds for quick opinions, 4-5 for deeper analysis
- Specify models explicitly when you want particular perspectives
- Use `systemPrompt` to focus the debate on specific aspects
- Check `list_providers` first to see which models are available
- One model failing won't abort the debate — results are resilient
- Engage with other models' specific points — agree, disagree, build upon, or challenge
