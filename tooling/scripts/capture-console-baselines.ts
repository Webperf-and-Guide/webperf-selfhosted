import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';

const baseUrl =
  process.env.BASE_URL ??
  process.env.SELFHOST_CONSOLE_BASE_URL ??
  (process.env.SELFHOST_CONSOLE_PORT
    ? `http://localhost:${process.env.SELFHOST_CONSOLE_PORT}`
    : 'http://localhost:5173');
const outputRoot = process.env.BASELINE_OUTPUT_DIR ?? 'output/playwright/console-baselines';

const routes = [
  { slug: 'overview', path: '/' },
  { slug: 'resources', path: '/resources' },
  { slug: 'checks', path: '/checks' },
  { slug: 'reports', path: '/reports' },
  { slug: 'regions', path: '/regions' }
] as const;

const viewports = [
  { slug: 'desktop', width: 1440, height: 1200 },
  { slug: 'mobile', width: 393, height: 852 }
] as const;

await mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch();

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });

    try {
      for (const route of routes) {
        const target = new URL(route.path, `${baseUrl}/`).toString();
        const outputPath = `${outputRoot}/${route.slug}-${viewport.slug}.png`;

        await page.goto(target, { waitUntil: 'networkidle' });
        await settleRoute(page, route.slug);
        await page.screenshot({ path: outputPath, fullPage: true });
      }
    } finally {
      await page.close();
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        outputRoot,
        routes: routes.map((route) => route.slug),
        viewports: viewports.map((viewport) => viewport.slug)
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}

async function settleRoute(page: Page, slug: (typeof routes)[number]['slug']) {
  switch (slug) {
    case 'overview':
      await page.locator('.control-card, .hero-copy').first().waitFor();
      break;
    case 'resources':
      await page.locator('.resources-section').first().waitFor();
      break;
    case 'checks':
      await page.locator('.checks-section').first().waitFor();
      break;
    case 'reports':
      await page.locator('.reports-section').first().waitFor();
      break;
    case 'regions':
      await page.locator('.regions-section').first().waitFor();
      break;
  }
}
