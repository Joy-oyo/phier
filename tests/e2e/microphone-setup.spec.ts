import { test, expect, type Page } from '@playwright/test';
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream'] } });
async function openMicrophone(page: Page) {
  if (!(await page.getByRole('region', { name: 'Microphone setup', exact: true }).isVisible())) {
    await page.getByRole('button', { name: 'Test microphone', exact: true }).click();
  }
}

for (const closeMethod of ['button', 'escape', 'toggle'] as const) {
  test(`compact microphone section collapses via ${closeMethod} and releases audio`, async ({
    page,
  }) => {
    await audioDevice(page);
    await page.goto('/');
    const launcher = page.locator('#microphone-test-launcher');
    const window = page.getByRole('region', { name: 'Microphone setup', exact: true });
    const card = page.getByRole('region', { name: 'Microphone test', exact: true });
    await expect(page.locator('.context-panel > .microphone-test-card')).toBeVisible();
    expect(await card.evaluate((node) => node === node.parentElement?.firstElementChild)).toBe(
      true,
    );
    await expect(window).not.toBeVisible();
    await openMicrophone(page);
    const start = window.getByRole('button', { name: 'Allow microphone & test' });
    await expect(start).toBeFocused();
    expect(await page.evaluate(() => (window as any).micStreams.length)).toBe(0);
    await start.click();
    await expect(window.getByRole('status')).toContainText('Sound detected');
    if (closeMethod === 'button')
      await page.getByRole('button', { name: 'Close microphone test' }).click();
    if (closeMethod === 'escape') await page.keyboard.press('Escape');
    if (closeMethod === 'toggle') await launcher.click();
    await expect(window).not.toBeVisible();
    await expect(launcher).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).micStreams.every((s: MediaStream) =>
            s.getTracks().every((t) => t.readyState === 'ended'),
          ),
        ),
      )
      .toBe(true);
    await openMicrophone(page);
    await expect(window.getByRole('status')).toContainText('Microphone not started');
    await page.setViewportSize({ width: 390, height: 844 });
    await window.scrollIntoViewIfNeeded();
    const box = await window.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    if (closeMethod === 'button')
      await page.screenshot({ path: 'test-results/microphone-compact-mobile.png' });
  });
}

test.describe('native browser microphone permission', () => {
  test('actual getUserMedia works after browser permission is granted, without API credits', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['microphone']);
    await page.goto('/');
    await openMicrophone(page);
    await page.getByRole('button', { name: 'Allow microphone & test' }).click();
    await expect(page.getByRole('button', { name: 'Stop microphone test' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Sound detected' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('capture-format')).toContainText('24 kHz mono PCM16');
    await expect(page.getByTestId('capture-format')).not.toContainText('0.0 seconds');
    await page.getByRole('button', { name: 'Stop microphone test' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'No audio is being captured' }),
    ).toBeVisible();
  });
});

for (const [name, expected] of [
  ['NotFoundError', 'No microphone was found'],
  ['NotReadableError', 'The microphone is unavailable'],
] as const) {
  test(`microphone failure ${name} has an actionable error`, async ({ page }) => {
    await page.addInitScript((errorName) => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('Test device failure', errorName);
      };
    }, name);
    await page.goto('/');
    await openMicrophone(page);
    await page.getByRole('button', { name: 'Allow microphone & test' }).click();
    await expect(page.getByRole('alert')).toContainText(expected);
    await expect(page.getByRole('button', { name: 'Allow microphone & test' })).toBeEnabled();
  });
}

test('embedding policy failures are explained before requesting microphone access', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'permissionsPolicy', { value: { allowsFeature: () => false } });
    navigator.mediaDevices.getUserMedia = async () => {
      throw new Error('Must not request microphone');
    };
  });
  const response = await page.goto('/');
  expect(response?.headers()['permissions-policy']).toBe('microphone=(self), camera=()');
  await openMicrophone(page);
  await page.getByRole('button', { name: 'Allow microphone & test' }).click();
  await expect(page.getByRole('alert')).toContainText('embedding page’s Permissions Policy');
});

test('leaving the page releases local capture without opening a network stream', async ({
  page,
}) => {
  await audioDevice(page);
  let sockets = 0;
  page.on('websocket', (socket) => {
    if (socket.url().includes('/api/audio')) sockets++;
  });
  await page.goto('/');
  await openMicrophone(page);
  await page.getByRole('button', { name: 'Allow microphone & test' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sound detected' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.getByRole('alert')).toContainText('Microphone stopped');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).micStreams.every((s: MediaStream) =>
          s.getTracks().every((t) => t.readyState === 'ended'),
        ),
      ),
    )
    .toBe(true);
  expect(sockets).toBe(0);
});

async function audioDevice(page: Page) {
  await page.addInitScript(() => {
    const testing = window as any;
    testing.micStreams = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      await context.resume();
      testing.micStreams.push(destination.stream);
      testing.micGain = gain;
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
}

test('setup stays on conversation, tests sound without cloud, and releases microphone on stop/navigation', async ({
  page,
}) => {
  await audioDevice(page);
  let cloudCalls = 0;
  page.on('request', (r) => {
    if (/\/api\/(connection\/check|translate|turn)$/.test(r.url())) cloudCalls++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up live listening', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Be part of the conversation.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test microphone', exact: true })).toBeFocused();
  await openMicrophone(page);
  const action = page.getByRole('button', { name: 'Allow microphone & test', exact: true });
  await expect(action).toBeFocused();
  await action.click();
  await expect(page.getByRole('status').filter({ hasText: 'Sound detected' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop microphone test' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).micStreams.every((s: MediaStream) =>
          s.getTracks().every((t) => t.readyState === 'ended'),
        ),
      ),
    )
    .toBe(true);
  await action.click();
  await expect(page.getByRole('status').filter({ hasText: 'Sound detected' })).toBeVisible();
  await page.getByRole('button', { name: 'Close microphone test' }).click();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).micStreams.every((s: MediaStream) =>
          s.getTracks().every((t) => t.readyState === 'ended'),
        ),
      ),
    )
    .toBe(true);
  expect(cloudCalls).toBe(0);
});

test('denied permission explains recovery and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Denied', 'NotAllowedError');
    };
  });
  await page.goto('/');
  await openMicrophone(page);
  await page.getByRole('button', { name: 'Allow microphone & test' }).click();
  await expect(page.getByRole('alert')).toContainText('Microphone access was denied');
  await expect(page.getByRole('alert')).toContainText('Chrome or Safari');
  await expect(page.getByRole('button', { name: 'Allow microphone & test' })).toBeEnabled();
});

test('cancelled pending permission cannot leave a microphone running', async ({ page }) => {
  await audioDevice(page);
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        (window as any).resolveMic = async () =>
          resolve(await capture.call(navigator.mediaDevices, { audio: true }));
      });
  });
  await page.goto('/');
  await openMicrophone(page);
  await page.getByRole('button', { name: 'Allow microphone & test' }).click();
  await page.getByRole('button', { name: 'Cancel microphone request' }).click();
  await page.evaluate(() => (window as any).resolveMic());
  await expect
    .poll(() => page.evaluate(() => (window as any).micStreams[0]?.getTracks()[0]?.readyState))
    .toBe('ended');
  await expect(
    page.getByRole('status').filter({ hasText: 'No audio is being captured' }),
  ).toBeVisible();
});

test('billing failure remains actionable on the conversation screen', async ({ page }) => {
  let connection: any;
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    connection ||= data.connection;
    data.connection = connection;
    await route.fulfill({ json: data });
  });
  await page.route('**/api/connection/check', async (route) => {
    connection.configured = true;
    for (const name of ['text', 'memory', 'speech'])
      connection[name] = { status: 'error', message: 'API credits exhausted', latencyMs: 1 };
    await route.fulfill({ json: connection });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Check connection', exact: true }).click();
  await expect(page.getByRole('link', { name: 'add API credits' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test microphone', exact: true })).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Start live conversation', exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/microphone-setup-mobile.png', fullPage: true });
});

test('complete setup to partial subtitles, silence commit, kana reply, next turn, and session stop', async ({
  page,
}) => {
  await audioDevice(page);
  let ready = false;
  let connection: any;
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    connection ||= data.connection;
    data.connection = connection;
    data.liveAvailable = ready;
    await route.fulfill({ json: data });
  });
  await page.route('**/api/connection/check', async (route) => {
    ready = true;
    connection.configured = true;
    for (const name of ['text', 'memory', 'speech'])
      connection[name] = { status: 'ready', message: 'Test service ready', latencyMs: 1 };
    await route.fulfill({ json: connection });
  });
  await page.route('**/api/translate', (route) =>
    route.fulfill({ json: { translation: 'What do you enjoy?' } }),
  );
  const turns: any[] = [];
  await page.route('**/api/turn', async (route) => {
    const body = route.request().postDataJSON();
    turns.push(body);
    await route.fulfill({
      json: {
        id: body.id,
        speaker: body.speaker,
        transcript: body.text,
        translation: body.speaker === 'partner' ? 'What do you enjoy?' : 'I enjoy tennis.',
        reply:
          body.speaker === 'partner'
            ? {
                responseText: 'テニスがすきです。',
                pronunciation: 'テニスがすきです。',
                meaning: 'I enjoy tennis.',
                memoryIdsUsed: [],
                targetLanguage: 'ja',
                pronunciationMode: 'kana',
              }
            : null,
        metrics: { translationMs: 1, generationMs: 1, totalMs: 2 },
      },
    });
  });
  let frames = 0;
  let commits = 0;
  let closed = false;
  await page.routeWebSocket('**/api/audio', (socket) => {
    socket.onMessage((message) => {
      if (typeof message !== 'string') {
        frames++;
        if (frames === 2)
          socket.send(
            JSON.stringify({ type: 'partial', itemId: 'turn-1', text: 'なにがすきですか' }),
          );
      } else if (JSON.parse(message).type === 'commit') {
        commits++;
        socket.send(
          JSON.stringify({
            type: 'final',
            itemId: `turn-${commits}`,
            text: commits === 1 ? 'なにがすきですか' : 'I enjoy tennis.',
          }),
        );
      }
    });
    socket.onClose(() => {
      closed = true;
    });
    socket.send(JSON.stringify({ type: 'ready' }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up live listening', exact: true }).click();
  await openMicrophone(page);
  await page.getByRole('button', { name: 'Allow microphone & test' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sound detected' })).toBeVisible();
  await page.getByRole('button', { name: 'Close microphone test' }).click();
  await page.getByRole('button', { name: 'Check connection', exact: true }).click();
  await page.getByRole('button', { name: 'Start live conversation', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).micStreams[0].getTracks()[0].readyState))
    .toBe('ended');
  await expect(page.getByText('なにがすきですか', { exact: true })).toBeVisible();
  await expect(page.locator('.subtitle-text')).toHaveText('What do you enjoy?');
  expect(commits).toBe(0);
  await page.evaluate(() => {
    (window as any).micGain.gain.value = 0;
  });
  await expect(page.locator('.pronunciation')).toHaveText('テニスがすきです。');
  await expect(page.locator('.reply-meaning')).toHaveText('I enjoy tennis.');
  await expect(page.getByRole('button', { name: 'Their turn', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'My turn', exact: true }).click();
  await page.evaluate(() => {
    (window as any).micGain.gain.value = 1;
  });
  const previous = frames;
  await expect.poll(() => frames).toBeGreaterThan(previous + 20);
  await page.evaluate(() => {
    (window as any).micGain.gain.value = 0;
  });
  await expect.poll(() => turns.length).toBe(2);
  expect(turns.map((t) => t.speaker)).toEqual(['partner', 'user']);
  expect(turns.every((t) => t.demo === false)).toBe(true);
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect.poll(() => closed).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).micStreams.every((s: MediaStream) =>
          s.getTracks().every((t) => t.readyState === 'ended'),
        ),
      ),
    )
    .toBe(true);
  await expect(page.locator('.reply-meaning')).toHaveCount(0);
});
