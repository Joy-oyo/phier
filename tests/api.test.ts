import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';

afterEach(() => vi.unstubAllGlobals());

it('explains a dropped reply connection without automatically resubmitting the turn', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetcher);
  await expect(api('/turn', { id: 'dropped-turn' })).rejects.toThrow(
    'Connection to Phier was interrupted',
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('preserves cancellation when a newer turn supersedes the request', async () => {
  const controller = new AbortController();
  const cause = new DOMException('Request cancelled', 'AbortError');
  controller.abort(cause);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
  await expect(api('/turn', {}, 'POST', controller.signal)).rejects.toBe(cause);
});

it('preserves the provider error when the server is reachable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Local model is not downloaded yet.' }), {
        status: 503,
      }),
    ),
  );
  await expect(api('/turn', {})).rejects.toThrow('Local model is not downloaded yet.');
});
