# Local mode

Local mode uses Ollama with `qwen3:4b-instruct` for generation and whisper.cpp with the multilingual base model for speech recognition. No paid API key is required. Speech is transcribed after a pause; this is not incremental word-by-word transcription. Small local models can be slower and less accurate than hosted models.

On macOS with Homebrew:

```sh
brew install ollama whisper-cpp
mkdir -p data/models/ollama
curl --http1.1 -fL --output data/models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
OLLAMA_MODELS="$PWD/data/models/ollama" OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 ollama serve
```

In another terminal, download the model, then launch Phier:

```sh
ollama pull qwen3:4b-instruct
npm run dev:local
```

Open http://localhost:5176/. Choose Knowledge sourcing to test an English passage, or use Check local models in the translation screen. The launcher starts missing local services and reuses ones already running. Existing `.env` cloud keys are preserved; process overrides select local providers for both modes. `PORT` and `OLLAMA_MODEL` can override the launcher's defaults. Do not run another Phier server on the same port.

To keep using the regular preview address on port 5173, stop the existing Phier server and run `PORT=5173 npm run dev:local`. The first launch can take longer while local services initialize the GPU; the launcher waits up to two minutes for them. Once the page opens, choose **Check connection** to verify the local reply model and speech service before starting a conversation.

Knowledge mode retrieves Wikipedia introductions and academic abstracts from Crossref using detected topic keywords. This lookup needs internet but no API credits. Full speech stays on this Mac; extracted keywords go to those public services. Explanations cite retrieved references and fail explicitly when no usable evidence is found. Coverage is narrower than full web search, particularly for current industry news and detailed historical claims. This reference tier caps contradiction flags at `!!`. Three exploratory questions accompany each saved result.

Translation mode also runs locally, including broad kana-to-IPA conversion. Automatic personal-memory extraction is paused. Knowledge library entries retain the existing per-browser ownership and local SQLite storage.

Models occupy roughly 2.7 GB combined, with additional RAM required while running. Model files are git-ignored under `data/models/`. Local endpoints bind to loopback; adapters reject remote endpoint URLs. If generation reports a missing model, check `ollama list` against the running server. If speech fails, ensure `whisper-server` has loaded the complete base model on port 8081.

References: [Ollama on macOS](https://docs.ollama.com/macos), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [whisper.cpp server](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server), [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/).
