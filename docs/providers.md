# Provider integration

`server/providers/types.ts` defines the interchangeable interfaces. Groq is preferred when `GROQ_API_KEY` is present; OpenAI is the fallback and there is no automatic mock fallback. Fixtures require the explicit `PHIER_ENABLE_DEMO=true` development flag; normal APIs reject fixture requests. Missing keys produce a setup state. `ProviderRuntime` reloads local `.env` configuration when the user chooses Check connection and reports text, memory and speech readiness separately. Explicit process environment variables override `.env` values.

`GET /api/connection` returns sanitized service status; `POST /api/connection/check` reloads configuration and performs small model calls and an audio-free speech-session handshake. Concurrent checks are coalesced. Keys and raw upstream error bodies never appear in the response. `npm run check:provider` exposes the same checks in a terminal.

## OpenAI adapter

An explicit `PHIER_PROVIDER=local` selects Ollama and whisper.cpp ahead of either cloud provider. `PHIER_KNOWLEDGE_PROVIDER=local` selects local generation with public Wikipedia/Crossref evidence retrieval. The `dev:local` launcher selects both automatically. See [Local mode](local-mode.md) for installation, limits and startup. Local endpoints are restricted to loopback and no paid provider is used for these paths.

The text adapter uses the Responses API with structured output and `store: false`. Model names can be overridden independently for response/translation and memory extraction. Secrets never enter Vite/client configuration.

The speech adapter opens a server-authenticated Realtime transcription WebSocket. It configures 24 kHz PCM and client-side turn commits. The default `gpt-live-transcribe` configuration uses plural language hints and no server VAD. It consumes incremental and completed transcription events keyed by item ID. Using an older committed-turn transcription model may delay transcript deltas until the turn is committed; that does **not** fulfill live subtitle behavior. Confirm capabilities before replacing this adapter.

The implementation was checked against official documentation on 2026-09-23:

- [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)

Live authentication, account-specific model access and actual microphone accuracy must be verified using your own configured account. The development build never requires or embeds a test credential.

## Groq free-MVP adapter

The Groq adapter uses the OpenAI-compatible Chat Completions endpoint at `https://api.groq.com/openai/v1`
with `qwen/qwen3.8-27b`, strict JSON output and reasoning disabled. It preserves the same structured-output validation used by the OpenAI
adapter. For this MVP, it receives the finalized utterance, translation, short recent window, tone,
context, and pronunciation settings. Saved personal-memory records are removed before the request,
and automatic model-based memory extraction returns no candidates. Manual memories stay local but
are not used to personalize Groq replies until the user explicitly enables that data sharing.

Groq generates a canonical kana reply. IPA is derived locally from that kana reading, and format
switches preserve the original words. This is broad mora-based transcription, without pitch accent,
vowel devoicing, or full dialect/allophone modeling. Unsupported readings fail explicitly.

The implementation was checked against Groq's official OpenAI compatibility, supported-model, and
structured-output documentation on 2026-09-28.

## HTTP endpoints

| Endpoint                         | Purpose                                           |
| -------------------------------- | ------------------------------------------------- |
| `GET /api/bootstrap`             | Settings, memories, provider capability state     |
| `PUT /api/settings`              | Validate and save preferences                     |
| `GET/POST /api/memories`         | List or explicitly add a personal fact            |
| `PUT/DELETE /api/memories/:id`   | Edit or forget a fact                             |
| `POST /api/memories/:id/approve` | Approve a pending sensitive/conflicting fact      |
| `POST /api/onboarding`           | Extract a profile draft without saving it         |
| `POST /api/onboarding/complete`  | Save user-selected memories and preferences       |
| `POST /api/translate`            | Translate the current partial or final text       |
| `POST /api/turn`                 | Process one finalized, speaker-labeled utterance  |
| `POST /api/pronounce`            | Convert an existing reply to the chosen format    |
| `POST /api/session/end`          | Clear the transient turn cache                    |
| `GET /api/metrics`               | Content-free latency records                      |
| `WS /api/audio`                  | Stream raw PCM frames; JSON commit/clear controls |

Mutation requests require `X-Phier-Client: 1`. Requests with non-local Host or foreign Origin are rejected. This is browser-origin protection for a local demo, not an authentication system. Production requires explicit user/session identity and storage isolation.

`/api/turn` accepts `{ id, text, speaker, recent, demo }`. The ID is a UUID, `speaker` is `partner` or `user`, `recent` contains at most four actual utterances, and `demo: true` always selects fixtures. A turn result includes its speaker, finalized translation, optional reply, and timings. Only partner turns have replies.

The audio socket emits `ready`, `partial`, `final`, and `error`. A partial/final event includes `itemId` and text. The client sends PCM as binary frames and `{ "type": "commit" }` at silence; `{ "type": "clear" }` discards an uncommitted turn when attribution changes. The server owns all external audio authentication.

## Replacing a provider

Implement the relevant interface, register it in `server/index.ts`, and run the core and browser tests. Preserve partial/final event semantics, cancellation, short-turn bounds, validated output and speaker attribution. Do not fake missing provider capabilities. An edge comparison should measure recognition error, latency, model download size, offline behavior, CPU/battery use, memory footprint and cost using the same Japanese recordings.
