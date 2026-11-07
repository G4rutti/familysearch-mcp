#!/usr/bin/env node
import { chromium } from 'playwright';
import { BROWSER_LAUNCH_OPTIONS, findBrowserExecutable, loadCookies } from './lib.mjs';

function normalizeDgs(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits || digits.length > 9) throw new Error('DGS must contain at most 9 digits.');
  return digits.padStart(9, '0');
}

function parseImageId(value) {
  return String(value || '').match(/3:1:[A-Z0-9-]+/i)?.[0] || '';
}

async function main() {
  const options = JSON.parse(process.argv[2] || '{}');
  const dgs = normalizeDgs(options.dgs);
  const startImage = Math.max(1, Math.trunc(options.startImage || 1));
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit || 20)));
  const executablePath = findBrowserExecutable();
  if (!executablePath) throw new Error('No supported Brave, Chrome, or Chromium browser found.');

  const browser = await chromium.launch({ executablePath, ...BROWSER_LAUNCH_OPTIONS });
  try {
    const context = await browser.newContext({ viewport: null });
    await context.addCookies(loadCookies());
    const page = await context.newPage();
    const filmDataPromise = page.waitForResponse(
      (response) => response.url().endsWith('/search/filmdatainfo/film-data') && response.status() === 200,
      { timeout: 90_000 },
    );
    const filmUrl = `https://www.familysearch.org/en/search/film/${dgs}?lang=en&i=0`;
    await page.goto(filmUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    if (page.url().includes('/auth/familysearch/login')) throw new Error('FamilySearch session expired. Run login-with-browser again.');
    const filmData = await (await filmDataPromise).json();
    const allImages = Array.isArray(filmData.images) ? filmData.images : [];
    const entries = allImages.slice(startImage - 1, startImage - 1 + limit).map((deepZoomUrl, offset) => {
      const imageId = parseImageId(deepZoomUrl);
      const imageNumber = startImage + offset;
      return {
        imageNumber,
        imageId,
        arkUrl: `https://www.familysearch.org/ark:/61903/${imageId}?i=${imageNumber - 1}`,
        thumbnailUrl: `https://www.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/${imageId}/thumb_p200.jpg`,
      };
    }).filter((entry) => entry.imageId);
    process.stdout.write(JSON.stringify({ dgs, total: allImages.length, startImage, filmUrl, entries }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
