# Memory and data retention

## Ownership

All memory belongs to the primary user. Partner profiles are out of scope. Only conversational onboarding, explicitly entered facts and utterances marked `speaker: user` can create memories. Generated replies are suggestions, not autobiographical evidence. Nationality/ethnicity, country of origin and spoken language are independent facts.

## Memory record

Each record has an ID, semantic key, concise content, category, applicable contexts, confidence, sensitivity, source, active/pending status and created/updated/last-used timestamps. Sources are onboarding, conversation or manual. All records are editable and deletable.

An empty `contexts` array means shared. Explicit scopes may include social, professional and dating. Retrieval first excludes unapproved records and records outside the current context, then ranks relevance and returns at most eight.

Conflicting automatic updates do not overwrite active information: they await review. Exact duplicate facts are ignored. Editing creates a manual fact. Deletion removes the record and leaves a SHA-256 fingerprint to prevent the same sentence from being learned again automatically. Explicit manual or approved onboarding re-entry remains possible. Fingerprints are not an anonymous-data guarantee, and semantic rephrasing can evade this simple deduplication.

Automatically inferred sensitive facts remain in process memory as pending suggestions; they are not written to SQLite until explicitly approved. Onboarding drafts stay in browser memory until the user saves selected entries; sensitive entries are unchecked by default. Sensitive fields manually entered and saved by the user are treated as explicitly approved. Sensitivity classification is model-based in cloud mode and may miss details; review or disable automatic learning as needed.

## Retention

| Data                                        | Behavior                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw audio                                   | Transient browser/relay/provider buffers; no application file storage                                                                          |
| Pre-roll                                    | Up to 300 ms in browser memory; cleared on commit/reset/stop                                                                                   |
| Translation-mode transcript/subtitles/reply | Current UI and up to four actual utterances in browser RAM; cleared on session end/reload                                                      |
| Knowledge discoveries                       | Speech excerpts associated with useful cards, explanations, citations and questions persist in SQLite until deleted from the browser's library |
| Turn retry cache                            | Up to 30 turn promises/results in server RAM, 30-second TTL, cleared on session end                                                            |
| Onboarding text                             | Browser component memory; posted for extraction; not saved as history                                                                          |
| Sensitive inferred candidates               | Server RAM until approval or restart; not used in replies while pending                                                                        |
| Settings and approved personal memories     | Local `data/phier.sqlite`; editable/deletable in UI                                                                                            |
| Timing metrics                              | Last 100 records, durations/context/demo flag only                                                                                             |
| Logs                                        | Startup/status only; no intentional audio or transcript logging                                                                                |

Stopping a session releases microphone access and clears the browser's transcript window and retry cache. In-flight model operations may already have transmitted data. SQL deletion is logical deletion; device backups and storage internals are outside the app's deletion guarantees. The SQLite file is not application-encrypted and is protected by the user's local OS account.

OpenAI cloud mode sends audio to ASR, speech text to translation, and only the recent window and retrieved memories to response generation. Memory extraction receives primary-user statements. The free Groq MVP path sends the finalized utterance, its translation, recent window and response settings, but strips all saved memory records and performs no automatic memory extraction. `store: false` disables Responses application storage where supported; it is not a promise of zero provider retention. Provider/account retention terms still apply.

Translation mode has no permanent transcript, audio archive or conversation-history feature. Knowledge mode deliberately saves relevant speech excerpts with its discoveries. Ending knowledge listening releases the microphone while queued research finishes; leaving the mode cancels unfinished work. Completed discoveries remain in the library. Knowledge mode does not learn personal memories. In cloud mode, its speech and recent topic context are sent to OpenAI for transcription and sourced research, with Responses storage disabled. See [Knowledge mode](knowledge-mode.md) for the browser identity, cookie lifetime, deletion controls and retention details.

## Local access

In [local mode](local-mode.md), speech recognition and text generation run on this Mac. Knowledge lookup sends detected topic keywords to Wikipedia and Crossref, but does not send the full speech excerpt to those services. Saved library retention and browser ownership remain the same. Local mode does not perform automatic personal-memory extraction.

The server binds to `127.0.0.1`. It is intended for one local user, with origin/host checks and bounded model concurrency. A publicly hosted or shared-network version needs authentication, per-user storage, transport protection, credential management and additional abuse controls before use.
