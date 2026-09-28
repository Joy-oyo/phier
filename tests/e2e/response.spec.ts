import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream'] },
  permissions: ['microphone'],
});

// Contract tests use browser audio plus controlled cloud events; no paid provider calls.
async function listen(page: Page) {
  let socket!: WebSocketRoute;
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.liveAvailable = true;
    data.trtc = { ...data.trtc, configured: false };
    data.settings.pronunciationMode = 'kana';
    data.settings.explanationLanguage = 'en';
    await route.fulfill({ json: data });
  });
  await page.route('**/api/translate', (route) =>
    route.fulfill({ json: { translation: 'What sport do you like?' } }),
  );
  await page.routeWebSocket('**/api/audio', (connection) => {
    socket = connection;
    connection.send(JSON.stringify({ type: 'ready' }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start listening', exact: true }).click();
  await expect.poll(() => Boolean(socket)).toBe(true);
  return (event: object) => socket.send(JSON.stringify(event));
}
function response(body: any, pronunciation = 'テニスが すきです。') {
  return {
    id: body.id,
    speaker: body.speaker,
    transcript: body.text,
    translation: 'What sport do you like?',
    reply: {
      responseText: pronunciation,
      pronunciation,
      meaning: 'I like tennis.',
      memoryIdsUsed: [],
      targetLanguage: 'ja',
      pronunciationMode: 'kana',
    },
    metrics: { translationMs: 1, generationMs: 1, totalMs: 2 },
  };
}

test('only a finalized question generates one kana reply; repeated final events do not duplicate it', async ({
  page,
}) => {
  const requests: any[] = [];
  await page.route('**/api/turn', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({ json: response(body) });
  });
  const send = await listen(page);
  send({ type: 'partial', itemId: 'question-1', text: 'すきなスポーツは' });
  await expect(page.locator('.subtitle-text')).toHaveText('What sport do you like?');
  expect(requests).toHaveLength(0);
  await expect(page.locator('.pronunciation')).toHaveCount(0);
  const final = { type: 'final', itemId: 'question-1', text: 'すきなスポーツはなんですか？' };
  send(final);
  send(final);
  await expect(page.locator('.pronunciation')).toHaveText('テニスが すきです。');
  expect(requests).toHaveLength(1);
  expect(requests[0].text).toBe(final.text);
  expect(requests[0].demo).toBe(false);
  await expect(page.getByRole('button', { name: 'Their turn', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  send({ type: 'final', itemId: 'question-2', text: 'ほかには？' });
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].speaker).toBe('partner');
  await page.getByRole('button', { name: 'End session', exact: true }).click();
});

test('reply failure keeps the captured question, permits retry, and never substitutes a sample', async ({
  page,
}) => {
  const requests: any[] = [];
  await page.route('**/api/turn', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (requests.length === 1)
      await route.fulfill({ status: 429, json: { error: 'Reply quota exhausted — test error' } });
    else await route.fulfill({ json: response(body) });
  });
  const send = await listen(page);
  send({ type: 'final', itemId: 'failed-question', text: 'すきなスポーツはなんですか？' });
  await expect(
    page.getByRole('region', { name: 'Suggested response' }).getByRole('alert'),
  ).toContainText('Reply quota exhausted');
  await expect(page.locator('.pronunciation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'End session', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry reply', exact: true }).click();
  await expect(page.locator('.pronunciation')).toHaveText('テニスが すきです。');
  expect(requests[0].id).toBe(requests[1].id);
  expect(requests[0].text).toBe(requests[1].text);
  await page.getByRole('button', { name: 'End session', exact: true }).click();
});

test('a newer finalized question supersedes an unfinished reply and ending clears it', async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  await page.route('**/api/turn', async (route) => {
    const body = route.request().postDataJSON();
    count++;
    if (count === 1) {
      await pending;
      await route.fulfill({ json: response(body, 'ふるい こたえです。') }).catch(() => {});
    } else await route.fulfill({ json: response(body, 'あたらしい こたえです。') });
  });
  const send = await listen(page);
  send({ type: 'final', itemId: 'old-question', text: 'さいしょのしつもんですか？' });
  await expect.poll(() => count).toBe(1);
  send({ type: 'final', itemId: 'new-question', text: 'つぎのしつもんですか？' });
  await expect(page.locator('.pronunciation')).toHaveText('あたらしい こたえです。');
  release();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('.pronunciation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry reply', exact: true })).toHaveCount(0);
});
