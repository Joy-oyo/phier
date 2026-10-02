# phier

A personal conversation companion. Understand Japanese as it is spoken, then see one short reply in hiragana/katakana (or IPA), with its meaning in your language.

Choose **Knowledge sourcing** for a second mode: listen to English speech and automatically see important terms, contextual explanations, industry/academic web sources, and three questions worth exploring. Sourced claim flags use `!`, `!!`, and `!!!` for increasing confidence of inaccuracy. Discoveries accumulate in a separate library for each browser. This mode uses `OPENAI_API_KEY` for speech and web research independently of the translation provider. See [Knowledge mode](docs/knowledge-mode.md) for setup, retention, and limitations.

## Run locally

Requires Node.js 22.13 or later and npm. Node's built-in SQLite may print an experimental-feature notice.

```sh
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173). Real cloud processing is the default. Without a key, phier shows setup instructions rather than producing fixture replies. Manual memory editing and preferences still work offline.

The app starts with an empty profile. Examples such as being Chinese or enjoying tennis are **not** saved as facts about you automatically. Use **Your profile** to introduce yourself or **Your memory** to add details.

### Enable live conversations

For a local option without API credits, see [Local mode](docs/local-mode.md). It uses Ollama and whisper.cpp for both modes, with public reference lookup for knowledge cards. After downloading the models, run `npm run dev:local` and open port 5176.

Copy `.env.example` to `.env`, then set:

```dotenv
GROQ_API_KEY=your-key
GROQ_TEXT_MODEL=qwen/qwen3.8-27b
```

When a Groq key is present, Phier selects it automatically for the free MVP response path. In this
privacy-first mode, saved personal memories remain local and automatic memory learning is paused;
use **Your memory** for local manual editing. OpenAI remains an optional fallback.

Use the compact **Microphone test** card above **Set the scene** in the context panel. Choose **Test microphone**, then **Allow microphone & test**. Approve the browser prompt and confirm **Sound detected** and an increasing captured duration. This local-only check uses the same 24 kHz mono PCM16 AudioWorklet capture path as live listening, with no audio upload, recording, or playback; it stops after 30 seconds, when you stop/leave the page, or when you collapse the card. Expanding the card alone does not request microphone access. Browser permission remains under your control. Choose the desired input device in your browser or system sound settings.

Then choose **Check connection**. This reloads `.env` without restarting and makes a small live reply test; with TRTC, speech readiness is checked from its local configuration. Only successful checks unlock **Start listening**. Chrome is the primary tested browser. Microphone capture requires HTTPS or localhost. The server permits same-origin microphone access and disables camera access; an embedding page must also grant microphone permission. An embedded browser may require host-app/system permission that this web app cannot grant. If blocked, open the address directly in Chrome or Safari.

Your account needs API billing/quota and access to the selected models. Credentials stay on the server. API requests incur usage charges. Put the key in the git-ignored `.env`, never `.env.example`. The template is safe to share only while its key field is blank.

The microphone captures 24 kHz mono PCM, local voice detection finds a pause, and the backend relays audio to a transcription session. Transcript fragments are translated into provisional subtitles; a finalized turn generates a short Japanese reply. No synthesized speech is played.

**Speaker attribution:** “Their turn” generates a reply. “My turn” learns personal facts from your actual words and does not generate a response. The selected speaker stays unchanged until you explicitly switch it. This version does not recognize voices. Verify the speaker control before sharing personal information; ambiguous partner audio must not be labeled as yours.

**Suggested responses:** Only finalized speech triggers generation; provisional captions never trigger a reply. The model answers the actual utterance using relevant preferences and the selected tone, with one short sentence (two at most). Kana is the default and is validated to exclude kanji and romaji; IPA remains opt-in. Final speech-service translations are reused when their language matches your settings. Duplicate final events do not create extra requests, and a newer utterance supersedes an unfinished reply. Generation failures show a Retry reply button without stopping an otherwise healthy speech stream; no sample answer is substituted.

Leaving the conversation screen ends an active listening/sample session and releases the microphone. Context and tone can be changed in place during a conversation.

### Real-time translation with TRTC

Listening can stream through Tencent RTC instead of the OpenAI speech session. TRTC returns each Japanese segment together with its translation, so subtitles appear without a separate language-model request.

Add these to `.env` and restart:

```dotenv
TRTC_SDK_APP_ID=yourSdkAppId
TRTC_SDK_SECRET_KEY=yourSdkSecretKey
TRTC_SOURCE_LANGUAGE=ja
TRTC_TARGET_LANGUAGE=en
```

Create an **RTC-Engine** application in the [TRTC console](https://console.trtc.io/) and enable speech-to-text and real-time translation on it ([SDK integration](https://trtc.io/document/79355?product=conversationalai), [Web SDK](https://trtc.io/document/59649)). UserSig is minted on the server, so the secret key never reaches the browser. Translation targets follow **Explanation language**; reply generation uses Groq when `GROQ_API_KEY` is present. Without these TRTC values, Phier requires an OpenAI key for its speech session.

### Sample mode

Fixtures are hidden and disabled in normal operation, including requests with a forged `demo` flag. Development tests explicitly set both `PHIER_ENABLE_DEMO=true` and `PHIER_PROVIDER=mock`. There is no automatic fixture fallback on missing credentials or provider failure. The capabilities below apply only to that opt-in development mode.

- Four explicit Japanese examples: weekend activities, work, days off, and origin.
- Generated sample replies use your relevant stored interests or an appropriate neutral question.
- English, Chinese, Spanish, French, and German meanings are available for the samples.
- Conversational onboarding recognizes conservative English patterns such as “I am Chinese,” “I am from China,” “I speak English and Mandarin,” “I enjoy golf and tennis,” and “I work as a designer.” Other facts can be entered manually. These examples are capabilities of the fixture parser, not assumptions about the user.
- Arbitrary speech and arbitrary-language understanding require cloud mode. Unsupported Japanese sample input produces an explicit message rather than a fabricated translation.
- Sample animation and timing are illustrative, not a benchmark of live ASR.

## Features

- Live subtitles and one suggested reply, usually one short sentence and at most two.
- Default Japanese pronunciation: hiragana + katakana, no kanji or romaji. Optional broad Japanese IPA.
- Explanation language selector; explicit spoken-language setting to inform easier-to-say phrasing.
- Social, professional and dating contexts, each with its own saved tone.
- Shared and context-specific personal memory, with add/edit/delete and “memories used” inspection.
- Conversational onboarding with an editable review before saving.
- Background learning only from primary-user statements, with duplicate detection, review of conflicts and memory deletion safeguards.
- Local SQLite persistence for settings/memories, minimal timing records, no audio files or permanent transcripts.
- Responsive desktop/mobile interface, keyboard controls, reduced-motion support and microphone/network error handling.
- Separate cloud/mock provider interfaces to support future wearable and edge clients.

## Commands

```sh
npm run dev          # Frontend and backend on localhost:5173
npm run typecheck    # Strict TypeScript checks
npm run check:provider # Small real API checks using your local .env key
npm test            # Core behavior tests, no credentials or network
npm run test:e2e     # Browser flows in installed Google Chrome; isolated in-memory DB
npm run build       # Production frontend + backend
npm start           # Serve the production build on localhost:5173
npm run format      # Format project source
```

The browser tests use port 5174. Install Google Chrome before running them, or change `channel` in `playwright.config.ts` to a locally available Playwright browser. Tests never call a paid model.

## Project layout

```text
src/                       React interface and local audio/VAD
src/components/            Profile, memory and preferences screens
public/audio-worklet.js    Audio-thread PCM capture
shared/                   Typed contracts and validation
server/app.ts             HTTP API
server/audio-relay.ts     WebSocket relay with bounded audio turns
server/service.ts         Conversation orchestration and asynchronous learning
server/store.ts           SQLite persistence and memory retrieval
server/providers/         Mock, Groq, and OpenAI adapters
tests/                    Core tests and browser flows
docs/                     Architecture, retention and provider documentation
```

## Current limits

This is a **local, single-user application**, bound to loopback. It has no public account system or multi-user isolation and should not be exposed publicly as-is. The live-verified badge requires successful text, memory and speech checks. A speech handshake check proves model access and session configuration, not microphone accuracy.

Live cloud behavior requires an API key and model access. Automated tests cover fixtures, orchestration, VAD and browser flows; they do not establish real-world Japanese ASR accuracy, IPA accuracy, accent performance, or provider latency. IPA is model-generated in cloud mode and should be reviewed by a Japanese speaker before relying on it for pronunciation instruction. Sample IPA is a broad transcription and does not display pitch accent.

VAD is a lightweight energy detector, not a trained speech/noise classifier. The silence threshold and noise threshold are adjustable. Simultaneous speakers, noisy rooms and speaking while a reply is being generated require further work; capture pauses during turn finalization/generation. The web demo uses explicit turn attribution rather than voice identity. Fully automatic user/partner identification is future work.

Memory retrieval uses a small keyword/category ranking system, scoped by context; it is not a semantic search engine. Automatic context changes, partner profiles, saved conversation history, speech playback, hardware integration, and other response languages are deferred.

See [architecture](docs/architecture.md), [provider integration](docs/providers.md), [memory and retention](docs/memory-and-privacy.md), and [verification](docs/verification.md).
