import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173';
const targetUrl = process.env.TARGET_URL ?? 'https://example.com';
const screenshotPath = process.env.SMOKE_SCREENSHOT_PATH ?? 'output/playwright/smoke-web.png';

await mkdir('output/playwright', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const selectedRegionsSummary = page.locator('.control-card .field strong').nth(0);

  if ((await selectedRegionsSummary.textContent())?.trim().startsWith('0 /')) {
    await page.getByRole('button', { name: /Tokyo/i }).click();
  }

  await page.locator('input[name="url"]').fill(targetUrl);
  await page.locator('button.submit').click();
  await page.waitForSelector('.result-card', { timeout: 20000 });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ ok: true, screenshotPath }, null, 2));
} finally {
  await browser.close();
}
