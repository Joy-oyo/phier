import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import type { KnowledgeEntry, KnowledgeInput } from '../../shared/knowledge';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream'] },
  permissions: ['microphone'],
});
const fixture = (input: KnowledgeInput): KnowledgeEntry => ({
  ...input,
  createdAt: '2026-09-28T12:00:00Z',
  cards: [
    {
      keyword: 'KV cache',
      explanation:
        'In this CDN discussion, KV means key-value storage near the edge. It is a different use of the term from attention caching during model inference.',
      background: 'The discussion is digging into persistence and eviction tradeoffs.',
      related: ['CDN', 'Cache eviction', 'Consistency'],
      sources: [
        { id: 0, title: 'Industry documentation (test fixture)', url: 'https://example.org/docs' },
      ],
      flag: {
        claim: input.text,
        explanation: 'Test evidence indicates this is an overstatement.',
        level: '!!',
        sources: [
          {
            id: 0,
            title: 'Industry documentation (test fixture)',
            url: 'https://example.org/docs',
          },
        ],
      },
    },
  ],
  questions: [
    'How does eviction affect a CDN?',
    'Where would stronger consistency help?',
    'How could edge caches and model caches interact?',
  ],
});
async function prepare(page: Page, options: { delay?: number; failOnce?: boolean } = {}) {
  let saved: KnowledgeEntry[] = [];
  const requests: KnowledgeInput[] = [];
  await page.route('**/api/knowledge/status', (route) =>
    route.fulfill({ json: { configured: true, message: 'Controlled test provider' } }),
  );
  await page.route('**/api/knowledge/library?*', (route) =>
    route.fulfill({ json: { entries: saved, nextOffset: null } }),
  );
  await page.route('**/api/knowledge/library/*', (route) => {
    const id = route.request().url().split('/').pop();
    saved = saved.filter((entry) => entry.id !== id);
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/knowledge/analyze', async (route) => {
    const input = route.request().postDataJSON() as KnowledgeInput;
    requests.push(input);
    if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
    if (options.failOnce) {
      options.failOnce = false;
      await route.fulfill({
        contentType: 'application/x-ndjson',
        body:
          JSON.stringify({ type: 'error', message: 'Research interrupted. Please retry.' }) + '\n',
      });
      return;
    }
    const entry = fixture(input);
    saved = [entry, ...saved];
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        [
          {
            type: 'keywords',
            topics: [{ keyword: 'KV cache', context: 'Caching in a CDN', deeper: true }],
          },
          { type: 'complete', entry },
        ]
          .map((event) => JSON.stringify(event))
          .join('\n') + '\n',
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Knowledge sourcing', exact: true }).click();
  return requests;
}
test('explains without clicking, shows three sparks and preserves a browsable library', async ({
  page,
}) => {
  await prepare(page);
  await page.getByLabel('Or add a passage').fill('KV caches in CDNs never evict data.');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page.locator('.knowledge-explanation')).toContainText('key-value storage');
  await expect(page.locator('.spark-card li')).toHaveCount(3);
  await expect(page.locator('.claim-flag .intensity-mark')).toHaveText('!!');
  await expect(
    page.locator('.knowledge-card .knowledge-sources').first().getByRole('link'),
  ).toHaveAttribute('href', 'https://example.org/docs');
  await expect(page.locator('.knowledge-background')).toBeVisible();
  await page.screenshot({ path: 'test-results/knowledge-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Your library', exact: true }).click();
  await expect(page.locator('.library-entry')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: 'Knowledge sourcing', exact: true }).click();
  await page.getByRole('button', { name: 'Your library', exact: true }).click();
  await expect(page.locator('.library-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete discovery about KV cache' }).click();
  await expect(page.locator('.library-entry')).toHaveCount(0);
});
test('queues final speech without replacing research, deduplicates speech events, and separates modes', async ({
  page,
}) => {
  let socket!: WebSocketRoute;
  let closed = false;
  let translations = 0;
  await page.route('**/api/turn', (route) => {
    translations++;
    return route.abort();
  });
  await page.route('**/api/translate', (route) => {
    translations++;
    return route.abort();
  });
  await page.routeWebSocket('**/api/knowledge/audio', (connection) => {
    socket = connection;
    connection.onClose(() => {
      closed = true;
    });
    connection.send(JSON.stringify({ type: 'ready' }));
  });
  const requests = await prepare(page, { delay: 350 });
  await page.getByRole('button', { name: 'Start listening', exact: true }).click();
  await expect.poll(() => !!socket).toBe(true);
  socket.send(JSON.stringify({ type: 'partial', itemId: 'first', text: 'A CDN uses' }));
  await expect(page.locator('.knowledge-transcript')).toHaveText('A CDN uses');
  expect(requests).toHaveLength(0);
  const first = { type: 'final', itemId: 'first', text: 'A CDN uses a KV cache.' };
  socket.send(JSON.stringify(first));
  socket.send(JSON.stringify(first));
  socket.send(
    JSON.stringify({ type: 'final', itemId: 'second', text: 'How does that affect eviction?' }),
  );
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.locator('.research-status')).toHaveCount(0);
  expect(translations).toBe(0);
  await page.getByRole('button', { name: 'Translation & phonetics' }).click();
  await expect.poll(() => closed).toBe(true);
  await expect(page.getByRole('region', { name: 'Suggested response' })).toBeVisible();
});
test('retains failed speech for explicit retry', async ({ page }) => {
  const requests = await prepare(page, { failOnce: true });
  await page.getByLabel('Or add a passage').fill('Explain KV cache.');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Research interrupted');
  await expect(page.locator('.knowledge-retry')).toContainText('Explain KV cache.');
  await page.getByRole('button', { name: 'Retry research' }).click();
  await expect(page.locator('.knowledge-explanation')).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0].id).toBe(requests[1].id);
});
test('fits a mobile viewport and shows honest missing-provider setup', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/knowledge/status', (route) =>
    route.fulfill({
      json: {
        configured: false,
        message: 'Add OPENAI_API_KEY in .env to enable English speech and sourced knowledge.',
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Knowledge sourcing' }).click();
  await expect(page.getByRole('button', { name: 'Start listening', exact: true })).toBeDisabled();
  await expect(page.locator('.knowledge-setup')).toContainText('OPENAI_API_KEY');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/knowledge-mobile.png', fullPage: true });
});
