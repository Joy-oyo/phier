# Verification

Run `npm test`, `npm run test:e2e` and `npm run build` from the project root.

Knowledge mode (2026-09-28): 44 unit/API tests passed and the production build and strict TypeScript checks succeeded. All 26 Chrome checks passed across the regression run and the four-test rerun after isolating local OpenAI, Groq and TRTC credentials from the browser-test environment. The four new knowledge browser checks cover explanations and citations without clicks, exactly three sparks, library review/deletion, queued final speech and duplicate events, mode cleanup, explicit retries, and 390 px layout. Desktop and mobile screenshots were inspected. API tests verify browser-owner isolation, persistence after database reopen, idempotent retries, invalid input, filler filtering, and failure sanitization. Citation tests reject unsafe/unretrieved URLs and ungrounded cards; claim flags require an actual spoken excerpt and evidence. A live provider probe could not complete inside the sandbox, and permission for an external live probe was declined. Real sourced-answer quality, cloud latency and physical-microphone accuracy remain unverified. See [Knowledge mode](knowledge-mode.md).

Response repair (2026-09-28): 34 unit tests and 22 Chrome browser tests passed, along with
TypeScript and the production build. A real Groq key/model probe succeeded. Live generation of
a generic clarification reply succeeded in kana and broad IPA, including conversions both ways.
Earlier live output exposed inconsistent kana readings and romaji labeled as IPA. Groq now produces
a canonical kana reading; local conversion derives broad IPA from it. Format conversion hides
the previous script while pending and restores the previous selection on failure. A speech-start
event no longer aborts a pending reply; a newer finalized utterance still supersedes it. Physical
microphone/ASR accuracy was not measured in this run. IPA omits pitch accent and vowel devoicing.

Latest verification (2026-09-28): 31 unit tests, 21 Chrome browser tests, strict TypeScript checking, and the production build passed. The Groq privacy test verifies that saved personal memories are removed from response inputs and that automatic memory extraction is paused. Automated audio tests use synthetic inputs and intercepted cloud events, not a physical microphone. The microphone test is a compact expandable card above Set the scene in the context panel. Tests verify placement, initial focus, focus restoration, fresh state on reopening, and microphone release for close-button, Escape and toggle collapse.

Response handoff tests verify that partial captions never generate replies, finalized utterances generate once, duplicate finals are ignored, the speaker stays manually selected, and a newer question supersedes a slow reply. Retry uses the captured utterance and request ID while preserving a healthy audio stream. Unit tests additionally check final translation reuse, wrong-language fallback translation, service-boundary kana validation, and cancellation. A separate real-model request with a generic Japanese question and no personal memories was attempted on 2026-09-25; the configured account returned exhausted API credits. Successful live kana generation remains unverified until billing is funded.

2026-09-25 microphone hardening: the local check now shares the live AudioWorklet capture code rather than using a separate analyser. It validates secure context, embedding policy, active audio tracks and worklet support; requests audio only; starts Web Audio from the button gesture; and releases capture on pagehide, cancellation, permission failure, device disconnection or processing failure. The local counter reports actual PCM frames captured without opening a speech WebSocket. Unit tests validate 480-sample PCM16 frame sizing, conversion and silence levels. Browser checks additionally cover missing/busy devices and blocked embedding policy. Physical microphone and live cloud translation still require manual acceptance testing.

Verification on 2026-09-23: 22 core tests passed, strict TypeScript checks passed, and the production client/server build succeeded. The expanded Chrome suite covers the setup-to-conversation workflow as well as the original flows. The missing-key and microphone setup screens were checked at 390 px width.

Microphone setup no longer redirects to Preferences or depends on cloud readiness. A browser-only diagnostic requests permission, shows measured sound levels, and stops automatically after 30 seconds. Browser tests cover denied permission, cancellation while permission is pending, explicit stop, navigation cleanup, and API billing errors. A native getUserMedia test uses Chrome's synthetic microphone and browser permission grant. Another full workflow test covers setup, partial recognition and translation, silence-triggered commit, kana reply, user turn, and session cleanup with stubbed cloud responses. These are not physical-microphone or live-cloud acceptance tests.

The additional streaming browser test sends synthesized audio through the actual AudioWorklet/VAD capture path into an intercepted WebSocket. It verifies binary PCM frames, provisional recognition and translated captions before completion, and socket closure on stop. The cloud events are test doubles: this does not verify real ASR accuracy. Normal mode shows measured microphone levels and streamed audio duration, never an artificial animated waveform. Recognized input appears separately from the translated subtitle.

Real text and speech requests were also attempted using the locally configured credential. Both services returned `credit_balance_exhausted` / `insufficient_quota`. API billing must be funded before successful live generation and microphone transcription can be verified. The application surfaces this account error and never falls back to fixture replies.

The unit suite exercises scoped memory retrieval, duplicate and conflict handling, deletion/re-entry, sensitive memory review, primary-user attribution, disabled learning, one-response idempotency, output validation, nationality/language separation, local VAD and transcription-session configuration.

The browser suite uses installed Chrome with an isolated in-memory database and mock providers. It covers memory CRUD and reload, personalized Japanese replies, kana/IPA switching, independent context tones, conversational onboarding, explanation-language switching, mobile overflow, canceling sample sessions and the live-provider setup screen.

Cloud integration is implemented against the documented interfaces, but live API calls and real microphone input are not part of the credential-free test suite. Do not interpret fixture passes as measured ASR quality or provider authentication success.

## Manual live check

### Local provider verification (2026-09-28)

On an Apple M2 with 24 GB RAM, installed Ollama 0.34.4 and whisper.cpp 1.9.4, downloaded `qwen3:4b-instruct` and multilingual Whisper base, and verified the Qwen weights against their registry SHA-256. Real local translation/reply and speech readiness checks passed. A warm translation-plus-kana-reply check took about 1.4 seconds; this is a single observation, not a latency guarantee.

A generated English WAV traversed the actual knowledge audio WebSocket and local Whisper endpoint successfully. Whisper transcribed “cached” as “cashed,” so terminology accuracy still needs real conversational evaluation. Physical microphone input has not been tested by the agent.

The browser's real local knowledge workflow produced sourced CDN/caching/latency cards and exactly three questions, using Wikipedia and Crossref excerpts. It saved the test discovery in the browser library. These were real model results, not fixtures. Unit/API tests: 50 passed. Browser regression suite: 26 passed, with 15 setup/microphone tests rerun successfully after wording changes. Typechecking and production build passed. The local model's initial romaji reply was corrected by constraining its generation schema to kana and rechecking successfully.

### Cloud provider check

1. In the context panel above Set the scene, click Test microphone to expand the compact card, then Allow microphone & test. Grant browser permission, speak, verify Sound detected, and stop the test or collapse the card. This requires no API key or credits. Expanding the card alone does not start capture. If an embedded browser cannot prompt, open localhost:5173 in Chrome or Safari.
2. Configure `.env`, fund API billing, and click Check connection. Then Start live conversation. Confirm the recording indicator is active only during the local test or live session.
3. With “Their turn” selected, speak a Japanese question. Confirm provisional meaning appears while speaking and one short reply appears after a pause.
4. Confirm kana contains no kanji and its English meaning matches. Test IPA separately with a qualified speaker.
5. After the reply, verify “Their turn” remains selected. Explicitly select “My turn,” state a personal preference, then inspect memory after the background operation finishes.
6. Interrupt or switch speakers, use the explicit turn control, and verify attribution stays correct.
7. End the session. Confirm microphone tracks stop and conversation text clears.
8. Repeat under realistic noise and network conditions; collect p50/p95 first-subtitle and silence-to-reply timings.

The in-app transcript/timing disclosure contains measured durations for the current turn. Sample-mode timings are local fixture execution, not cloud latency. There is no claimed live latency SLA yet.
