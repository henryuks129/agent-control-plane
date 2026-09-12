# Media generation

ACP treats media generation as a separate capability from chat. A media profile declares its capability, endpoint and expected output type; text-to-image currently prefers NVIDIA FLUX.1-schnell and falls back to FLUX.2-klein-4b after a retryable failure.

`media:image` selects an enabled, healthy `text-to-image` profile, submits a bounded request, saves the returned image under the local artifacts directory, and records the model, profile, prompt, seed and MIME type in SQLite. API keys and response headers are never persisted.

Video generation is intentionally not included in this first path. It needs a separate contract for image inputs, long-running jobs and potentially asynchronous result polling.

## Switching image models

List available image profiles with `media:models`. Use a specific profile with `media:image "your prompt" <profile-id>`. Add additional NVIDIA media profiles through `ACP_MEDIA_MODELS_JSON`; this extends the built-in profiles without replacing the chat-agent profiles.

Each added profile must include `id`, `provider`, `model`, `capabilities` (including `text-to-image`), `maxConcurrent`, `enabled`, and `media: { "kind": "image", "endpoint": "https://..." }`.
