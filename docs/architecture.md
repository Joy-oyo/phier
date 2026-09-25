# Architecture

Phier separates audio capture, language intelligence and personal memory. React/Vite renders the web client. Express and WebSocket run the local Node server. Node's SQLite stores durable structured state; no external database is required.

```text
Microphone → AudioWorklet (24 kHz PCM) → local VAD
                                      ↓ WebSocket
                         backend ASR provider → partial Japanese text
                                      ↓
                         coalesced translation requests → live subtitles
                                      ↓ local silence commit
                         finalized transcript + speaker attribution
                                      ↓
       partner turn → scoped memory → reply + pronunciation + meaning
       primary turn → background extraction → active memory or review
```

## Conversation state

The UI distinguishes idle, connecting, listening, processing, ready and error. Capture is paused after commit until the current turn completes, so the same utterance cannot create multiple replies. A successful partner turn moves the speaker control to “My turn”; a user turn moves it back. These are turn-taking hints, not voice recognition.

The audio thread groups mono PCM16 samples into 20 ms frames. The browser retains up to 300 ms of pre-roll in memory, waits for 100 ms of speech-like energy, streams frames while speaking, and commits once after the configured silence window (850 ms default). Turns are capped at 30 seconds. The relay limits audio size, pending turns and simultaneous connections; sessions expire after 15 minutes. The browser releases microphone tracks and closes the audio context on stop or failure.

Live transcript deltas are coalesced with a 650 ms translation interval. At most one provisional translation is active. On finalization, provisional work is canceled and versioned so late partial responses cannot replace finalized text. The response HTTP API uses turn IDs for retry deduplication; a short, bounded in-memory cache expires after 30 seconds and clears on session end.

Only actual speech enters the recent conversational window (at most four utterances). Generated suggestions are not recorded as things the user said. A user can correct a finalized transcript and explicitly request a replacement result.

## Response path

The response provider receives current text, translation, a short recent window, selected context and its tone, explanation language, pronunciation mode, explicitly known spoken languages, and at most eight relevant active memories. It returns one structured response. Schema and application validation reject malformed output, non-kana characters in kana mode, replies over two sentences, or unknown memory IDs. The OpenAI adapter has one bounded regeneration attempt after validation failure.

The cloud adapter produces Japanese text, pronunciation and meaning together to avoid adding a serial model call to every turn. A separate pronunciation interface handles format changes and can be replaced with a dictionary/phonology-based implementation. Background memory extraction uses its own configurable model and never delays the reply.

## Persistence and contexts

Settings include explanation language, spoken languages, pronunciation mode, VAD thresholds, automatic learning and a tone per context. An empty context array on a memory means shared; otherwise a memory is eligible only in its explicitly assigned contexts. There is no implicit transfer of dating details into business replies.

Relevant-memory ranking currently uses question topics and memory categories. Future semantic retrieval can replace this function without changing the UI or response-provider contract.

## Toward wearables

Keep the backend HTTP and streaming contracts. A wearable client can send framed audio and display the pronunciation/meaning pair. The `AsrProvider`, `TranslationProvider`, `ResponseProvider`, `PronunciationProvider`, and `MemoryProvider` interfaces can be implemented with on-device or edge runtimes. Device identity, authentication, speaker attribution, reconnect buffering, battery use and practical latency require separate evaluation before a wearable pilot.

## Latency instrumentation

The transcript/timing disclosure shows final translation, response generation, client time after turn end, and first provisional subtitle latency in live sessions. Stored metrics omit conversation content and keep the last 100 turns. `/api/metrics` returns the 30 most recent records. The configured silence interval is separate from the displayed after-turn-end latency.

Measure live latency at p50/p95 on the intended network and device before setting a product SLA. Mock timings are not cloud measurements. Live targets for evaluation—not claimed achievements—are a first provisional subtitle within 1.5 seconds of useful recognized speech and a short reply within 2.5 seconds after the silence commit under typical conditions.
