# Knowledge sourcing

Choose **Knowledge sourcing** in the mode switch or **Knowledge** in the sidebar. Translation and phonetics keep their existing provider and behavior. Knowledge mode listens to English, displays keywords immediately after detection, then automatically fills cards with concise explanations, related concepts and clickable sources. Follow-up speech can request deeper historical or technical background. Each researched passage produces exactly three questions worth exploring.

## Setup

Knowledge uses `OPENAI_API_KEY` for English transcription and web research, including when translation uses Groq/TRTC. The optional `OPENAI_KNOWLEDGE_MODEL` must support Responses API web search and structured output; its default is `OPENAI_TEXT_MODEL`, or `gpt-4.1-mini`. Speech uses `OPENAI_TRANSCRIBE_MODEL` with English selected. These are paid API operations. No fixture data is substituted for a provider error.

The cloud workflow first identifies up to four relevant topics, searches industry and academic evidence where relevant, then formats the evidence into cards. Only URLs returned as actual web citation annotations can enter a cloud card. The implementation follows the [OpenAI web search documentation](https://developers.openai.com/api/docs/guides/tools-web-search). Source availability and model judgments still need evaluation with real conversations; a citation is not a guarantee of correctness.

[Local mode](local-mode.md) uses local Whisper and Ollama, detects up to three topics, and cites retrieved Wikipedia introductions and Crossref academic abstracts. It requires no paid API credits. Coverage is narrower, speech finalizes after pauses, and contradiction confidence is capped at `!!` for this limited reference tier.

## Claim marks

- `!`: possible inaccuracy; evidence needs qualification.
- `!!`: likely inaccurate; direct contradicting evidence.
- `!!!`: strongly contradicted; corroborated authoritative evidence.

Marks represent confidence in contradictory evidence, not severity or calibrated probabilities. Flags must quote the actual latest speech and have their own citations. `!!!` is capped at `!!` when citations do not span at least two hosts; the model is also instructed to require genuinely independent authoritative evidence. Different hosts alone do not establish independence. Opinions, ambiguity, and lack of evidence should not be flagged. Historical claims must be checked against their original timeframe: later success does not refute earlier difficulty.

## Browser library

Completed discoveries accumulate in SQLite, isolated by a random 256-bit browser cookie (`HttpOnly`, `SameSite=Strict`). Only a SHA-256 digest identifies the owner in the database; client-supplied owner IDs are never accepted. Libraries persist through server/browser restarts, subject to the cookie's one-year lifetime. This is a local browser identity, not a login: browsers/profiles have separate libraries and clearing the cookie loses access. There is no cross-device sync or account recovery. Translation preferences and personal memories retain their existing local, shared storage model.

Saved data includes the speech excerpt that triggered a useful card, session ID, explanations, background, sources, claim flags and questions. Audio is not saved. Filler and passages yielding no useful cards are not stored. In cloud mode, relevant speech and recent context are sent to OpenAI; web lookup can send topic queries to search services. Responses use `store: false`, which does not override the provider's own retention policy.

Open **Your library** to review or delete discoveries. It loads 50 entries at a time, with a **Load earlier discoveries** control. Search filters loaded entries. **New session** clears the live workspace while preserving the library.

## Live behavior and failures

Partial speech is shown as a transcript; only final speech triggers research. Microphone capture resumes as soon as a final transcript arrives, independently of the research queue. Requests run sequentially to preserve context and avoid cancelling earlier discoveries. At eight queued passages, listening pauses with a notice while captured work drains. A failed lookup pauses listening and retains the passage for retry or explicit skip. Ending listening lets queued research finish. Leaving knowledge mode cancels unfinished research and releases the microphone; completed discoveries remain saved.

The knowledge speech relay is separate from the translation relay. It uses `/api/knowledge/audio`, English ASR and the existing audio/VAD implementation, avoiding changes to the TRTC translation pipeline.
