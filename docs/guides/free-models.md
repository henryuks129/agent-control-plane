# Use free models with ACP

ACP is free and open source. You can run it entirely on free models, or let
one paid agent (Claude Code or Codex) plan while free models do the work.

Free lineups change often. The model names below are examples from November
2026. Always check the live list (the step says where).

## Pick a path

| Path | Cost | Good for | Tools and sub-agents |
|---|---|---|---|
| **OpenCode Zen free models** | Free, rate-limited | Everyday coding tasks | Yes, from OpenCode |
| **NVIDIA (build.nvidia.com)** | Free trial credits, about 40 requests a minute | Reasoning and large models, such as Nemotron | Yes, when run through OpenCode |
| **Ollama (local)** | Free, runs on your Mac | Private work, tests, small edits | Yes, when run through OpenCode |

A model on its own only writes text. To edit files and run commands, it needs a
harness. OpenCode is that harness for free models, so we recommend running all
three paths through OpenCode.

## 1. Install OpenCode

```bash
npm install -g opencode-ai
```

Check it works:

```bash
opencode --version
```

## 2. OpenCode Zen free models

1. Run `opencode` in any project.
2. Type `/connect`, choose **OpenCode Zen**, and sign in at opencode.ai to get
   a key.
3. Type `/models`. Models marked **Free** cost nothing. Examples seen in late
   2026: Nemotron 3 Super Free, MiMo-V2.5 Free, Big Pickle.

Free models have per-IP limits. If one is rate-limited, pick another.

## 3. NVIDIA models

1. Sign in at [build.nvidia.com](https://build.nvidia.com), open a model (for
   example a Nemotron model) and choose **Get API Key**. Keys start with
   `nvapi-`.
2. Add NVIDIA to OpenCode with `/connect`, or set the key for ACP's built-in
   NVIDIA client:

   ```bash
   export NVIDIA_API_KEY=nvapi-...
   ```

   ACP uses `https://integrate.api.nvidia.com/v1` by default
   (`NVIDIA_BASE_URL` changes it).

The free tier is a trial for development, not production use. Check your
credits and limits on build.nvidia.com.

## 4. Local models with Ollama

```bash
brew install ollama
```

```bash
ollama pull llama3.1
```

Ollama serves an OpenAI-compatible API at `http://localhost:11434/v1`. Add it
to OpenCode as a provider, and ACP will see it as a local model. Nothing leaves
your machine.

## 5. Add them to ACP

> Planned (ADR-0007 action items 1, 14). The commands below are the target
> design and do not exist yet.

```bash
acp agents add opencode
```

```bash
acp models
```

ACP reads which models OpenCode can use and tags each one by capability:
reasoning, vision, fast or local. Star a paid agent as orchestrator, and it
hands tasks to these models by capability.

## Privacy

- OpenCode Zen and NVIDIA free tiers may log prompts. Read each provider's
  terms before sending private code.
- DeepSeek's API processes data in China.
- Ollama keeps everything local.
