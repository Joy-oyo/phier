# Verification

Run `npm test`, `npm run test:e2e` and `npm run build` from the project root.

Latest verification (2026-09-25): 30 unit tests, 21 Chrome browser tests, strict TypeScript checking, and the production build passed. Automated audio tests use synthetic inputs and intercepted cloud events, not a physical microphone. The microphone test is a compact expandable card above Set the scene in the context panel. Tests verify placement, initial focus, focus restoration, fresh state on reopening, and microphone release for close-button, Escape and toggle collapse.

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

1. In the context panel above Set the scene, click Test microphone to expand the compact card, then Allow microphone & test. Grant browser permission, speak, verify Sound detected, and stop the test or collapse the card. This requires no API key or credits. Expanding the card alone does not start capture. If an embedded browser cannot prompt, open localhost:5173 in Chrome or Safari.
2. Configure `.env`, fund API billing, and click Check connection. Then Start live conversation. Confirm the recording indicator is active only during the local test or live session.
3. With “Their turn” selected, speak a Japanese question. Confirm provisional meaning appears while speaking and one short reply appears after a pause.
4. Confirm kana contains no kanji and its English meaning matches. Test IPA separately with a qualified speaker.
5. After the reply, verify “Their turn” remains selected. Explicitly select “My turn,” state a personal preference, then inspect memory after the background operation finishes.
6. Interrupt or switch speakers, use the explicit turn control, and verify attribution stays correct.
7. End the session. Confirm microphone tracks stop and conversation text clears.
8. Repeat under realistic noise and network conditions; collect p50/p95 first-subtitle and silence-to-reply timings.

The in-app transcript/timing disclosure contains measured durations for the current turn. Sample-mode timings are local fixture execution, not cloud latency. There is no claimed live latency SLA yet.
