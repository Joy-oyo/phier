import { test, expect } from '@playwright/test';

test('personalized conversation, pronunciation, contexts, and memory lifecycle', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Be part of the conversation.' })).toBeVisible();
  await page.getByRole('button', { name: 'Your memory' }).click();
  await page.getByRole('button', { name: 'Add a memory', exact: true }).click();
  await page.getByLabel('What should phier know?').fill('I enjoy tennis.');
  await page.getByRole('button', { name: 'Save memory' }).click();
  await expect(page.locator('.memory-content')).toHaveText('I enjoy tennis.');
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Weekend plans' }).click();
  await expect(page.locator('.reply-meaning')).toHaveText('I like tennis.', { timeout: 15_000 });
  await expect(page.locator('.pronunciation')).toHaveText('テニスが すきです。');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Shaped by 1 memory' }).click();
  await expect(page.locator('.used-memories')).toContainText('I enjoy tennis.');
  await page.getByRole('button', { name: 'IPA', exact: true }).click();
  await expect(page.locator('.pronunciation')).toHaveText('/tenisɯ ɡa sɯki desɯ/');
  await page.getByRole('button', { name: 'かな', exact: true }).click();
  await expect(page.locator('.pronunciation')).toHaveText('テニスが すきです。');
  await page.getByRole('button', { name: 'Dating A little more personal' }).click();
  await expect(page.getByRole('button', { name: 'casual', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Social Easy, everyday connections' }).click();
  await expect(page.getByRole('button', { name: 'regular', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: /Your memory/ }).click();
  await page.getByRole('button', { name: 'Edit I enjoy tennis.' }).click();
  await page.getByLabel('What should phier know?').fill('I enjoy golf.');
  await page.getByRole('button', { name: 'Save memory' }).click();
  await expect(page.locator('.memory-content')).toHaveText('I enjoy golf.');
  await page.reload();
  await page.getByRole('button', { name: /Your memory/ }).click();
  await expect(page.locator('.memory-content')).toHaveText('I enjoy golf.');
  await page.getByRole('button', { name: 'Delete I enjoy golf.' }).click();
  await page.getByRole('button', { name: 'Forget memory', exact: true }).click();
  await expect(page.locator('.memory-card')).toHaveCount(0);
});

test('conversational onboarding and configurable explanation language', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Your profile', exact: true }).click();
  for (const answer of [
    'I am Chinese. I speak English and Mandarin.',
    'I enjoy golf and tennis.',
    'Social and professional conversations.',
    'Explanations in Chinese. I prefer kana.',
  ]) {
    await page.getByRole('textbox', { name: 'Your introduction' }).fill(answer);
    await page.getByRole('button', { name: 'Send introduction' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Does this sound like you?' })).toBeVisible();
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page.getByRole('heading', { name: 'Nice to know you.' })).toBeVisible();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Weekend plans' }).click();
  await expect(page.locator('.reply-meaning')).toHaveText('我喜欢高尔夫和网球。', {
    timeout: 15_000,
  });
  await expect(page.locator('.subtitle-text')).toContainText('你周末通常做什么');
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Explanation language' })).toHaveValue('zh');
  await expect(page.getByRole('combobox', { name: 'Japanese pronunciation' })).toHaveValue('kana');
});

test('mobile layout, sample cancellation, and provider setup are usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Weekend plans' }).click();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('.reply-meaning')).toHaveCount(0);
  await page.waitForTimeout(2300);
  await expect(page.locator('.reply-meaning')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Set up live listening', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Test microphone', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check connection', exact: true })).toBeVisible();
});
