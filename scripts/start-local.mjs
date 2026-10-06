import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const modelPath = resolve('data/models/ggml-base.bin');
const ollamaModels = resolve('data/models/ollama');
if (!existsSync(modelPath) || statSync(modelPath).size !== 147951465)
  throw new Error('Local Whisper base model is missing or incomplete. See docs/local-mode.md.');
mkdirSync(ollamaModels, { recursive: true });
const children = [];
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1000).unref();
}
function launch(command, args, env = {}) {
  const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    shutdown(1);
  });
  child.on('exit', (code) => {
    if (!stopping) shutdown(code || 0);
  });
  return child;
}
async function reachable(url) {
  try {
    const result = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return result.status < 500;
  } catch {
    return false;
  }
}
async function waitFor(url) {
  // The first launch may compile Metal shaders before the service can listen.
  const until = Date.now() + 120_000;
  while (!(await reachable(url))) {
    if (stopping || Date.now() > until) throw new Error(`Local service did not start: ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
try {
  if (!(await reachable('http://127.0.0.1:11434/api/tags')))
    launch('ollama', ['serve'], {
      OLLAMA_HOST: '127.0.0.1:11434',
      OLLAMA_MODELS: ollamaModels,
      OLLAMA_NO_CLOUD: '1',
    });
  if (!(await reachable('http://127.0.0.1:8081/')))
    launch('whisper-server', [
      '--host',
      '127.0.0.1',
      '--port',
      '8081',
      '-m',
      modelPath,
      '-l',
      'auto',
      '-t',
      '4',
    ]);
  await Promise.all([
    waitFor('http://127.0.0.1:11434/api/tags'),
    waitFor('http://127.0.0.1:8081/'),
  ]);
  launch('npm', ['run', 'dev'], {
    PHIER_PROVIDER: 'local',
    PHIER_KNOWLEDGE_PROVIDER: 'local',
    OLLAMA_URL: 'http://127.0.0.1:11434',
    WHISPER_URL: 'http://127.0.0.1:8081',
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen3:4b-instruct',
    PORT: process.env.PORT || '5176',
  });
} catch (error) {
  console.error(error.message);
  shutdown(1);
}
