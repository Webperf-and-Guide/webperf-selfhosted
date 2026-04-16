import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl =
  process.env.BASE_URL ??
  process.env.SELFHOST_CONSOLE_BASE_URL ??
  (process.env.SELFHOST_CONSOLE_PORT
    ? `http://localhost:${process.env.SELFHOST_CONSOLE_PORT}`
    : 'http://localhost:5173');
const targetUrl = process.env.TARGET_URL ?? 'https://example.com';
const screenshotPath = process.env.SMOKE_SCREENSHOT_PATH ?? 'output/playwright/smoke-web.png';

await mkdir('output/playwright', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('input[name="url"]').waitFor();

  const selectedRegionsSummary = page
    .locator('.control-card .field')
    .filter({ hasText: /Selected regions/i })
    .locator('strong');

  if ((await selectedRegionsSummary.count()) > 0) {
    const selectedText = (await selectedRegionsSummary.first().textContent())?.trim() ?? '';

    if (selectedText.startsWith('0 /')) {
      const tokyoButton = page.getByRole('button', { name: /Tokyo/i });

      if ((await tokyoButton.count()) > 0) {
        await tokyoButton.first().click();
      }
    }
  }

  await page.locator('input[name="url"]').fill(targetUrl);
  await page.getByRole('button', { name: /Start measurement/i }).click();
  await Promise.race([
    page.waitForSelector('.job-summary, .result-card', { timeout: 20000 }),
    page.waitForSelector('.error', { timeout: 20000 })
  ]);

  const errorMessages = await page.locator('.error').allTextContents();
  const blockingError = errorMessages.find(
    (message) => !/inflight measurement job/i.test(message)
  );

  if (blockingError) {
    throw new Error(blockingError);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ ok: true, screenshotPath }, null, 2));
} finally {
  await browser.close();
}
