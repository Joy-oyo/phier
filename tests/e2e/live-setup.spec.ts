import { test, expect } from '@playwright/test';
test('missing credentials show real setup and never return fixture output', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByText('API key needed', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weekend plans' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check connection', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No API key found');
  const headers = { 'X-Phier-Client': '1' };
  const demo = await request.post('/api/turn', {
    headers,
    data: {
      id: crypto.randomUUID(),
      text: '週末は何をしていますか？',
      speaker: 'partner',
      demo: true,
    },
  });
  expect(demo.status()).toBe(403);
  const live = await request.post('/api/turn', {
    headers,
    data: { id: crypto.randomUUID(), text: '好きな映画は何ですか？', speaker: 'partner' },
  });
  expect(live.status()).toBe(503);
  expect((await live.json()).error).toContain('API key');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('microphone PCM reaches the socket and partial recognition appears before turn completion', async ({
  page,
}) => {
  // Deterministic transport test: synthesized audio and stubbed cloud, never the user's microphone.
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.liveAvailable = true;
    data.connection.configured = true;
    await route.fulfill({ json: data });
  });
  await page.route('**/api/translate', (route) =>
    route.fulfill({ json: { translation: 'Live test translation' } }),
  );
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext({ sampleRate: 24000 });
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      await context.resume();
      destination.stream.getTracks().forEach((track) => {
        const stop = track.stop.bind(track);
        track.stop = () => {
          stop();
          oscillator.stop();
          void context.close();
        };
      });
      return destination.stream;
    };
  });
  let frames = 0;
  let closed = false;
  await page.routeWebSocket('**/api/audio', (socket) => {
    socket.onMessage((message) => {
      if (typeof message !== 'string') {
        frames++;
        if (frames === 2)
          socket.send(
            JSON.stringify({ type: 'partial', itemId: 'stream-test', text: 'いま話しています' }),
          );
      }
    });
    socket.onClose(() => {
      closed = true;
    });
    socket.send(JSON.stringify({ type: 'ready' }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start listening', exact: true }).click();
  await expect.poll(() => frames).toBeGreaterThan(2);
  await expect(page.getByText('いま話しています', { exact: true })).toBeVisible();
  await expect(page.getByText('Live test translation', { exact: true })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Microphone input level' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weekend plans' })).toHaveCount(0);
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect.poll(() => closed).toBe(true);
  await expect(
    page.getByRole('region', { name: 'Incoming subtitles' }).getByText('いま話しています'),
  ).toHaveCount(0);
});
