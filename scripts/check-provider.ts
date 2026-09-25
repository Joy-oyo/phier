import { ProviderRuntime } from '../server/providers/runtime';
const runtime = new ProviderRuntime();
const result = await runtime.check();
// Only sanitized status and model names; never keys or upstream error bodies.
console.log(JSON.stringify(result, null, 2));
if (!runtime.liveAvailable) process.exitCode = 1;
