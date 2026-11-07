#!/usr/bin/env node
/**
 * Opens an installed browser for FamilySearch login and saves the session cookie locally.
 * Prefers Brave, then falls back to Chrome or Chromium.
 *
 * Usage: npm run login
 */
import { chromium } from 'playwright';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BROWSER_LAUNCH_OPTIONS, configDir, configPath, findBrowserExecutable } from './lib.mjs';

const browserProfileDir = join(configDir, 'browser-profile');

function loadConfig() {
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
  chmodSync(configDir, 0o700);
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(configPath, 0o600);
}

function readLoggedInUser(page) {
  return page.evaluate(() => {
    const userKey = Object.keys(localStorage).find((key) => key.endsWith('-v3-user'));
    if (!userKey) {
      return null;
    }

    try {
      const data = JSON.parse(localStorage.getItem(userKey) || '{}');
      const user = data.user;
      if (!user?.cisId) {
        return null;
      }

      return {
        displayName: user.displayName || user.contactName || 'FamilySearch user',
        personId: user.personId || '',
      };
    } catch {
      return null;
    }
  });
}

async function main() {
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    console.error('No supported Brave, Chrome, or Chromium browser found.');
    console.error('Set FAMILYSEARCH_BROWSER_PATH to your browser executable.');
    process.exit(1);
  }

  if (!existsSync(browserProfileDir)) {
    mkdirSync(browserProfileDir, { recursive: true, mode: 0o700 });
  }

  console.error(`Opening browser for FamilySearch login (${browserPath})...`);
  console.error('Sign in at familysearch.org. This window waits until you are fully logged in (up to 15 minutes).');

  const context = await chromium.launchPersistentContext(browserProfileDir, {
    executablePath: browserPath,
    viewport: null,
    ...BROWSER_LAUNCH_OPTIONS,
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://www.familysearch.org/en/');

  try {
    await page.waitForFunction(
      () => {
        const userKey = Object.keys(localStorage).find((key) => key.endsWith('-v3-user'));
        if (!userKey) {
          return false;
        }

        try {
          const data = JSON.parse(localStorage.getItem(userKey) || '{}');
          return Boolean(data.user?.cisId);
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: 15 * 60 * 1000 },
    );
  } catch {
    console.error('Timed out waiting for login.');
    await context.close();
    process.exit(1);
  }

  const user = await readLoggedInUser(page);
  const cookies = await context.cookies(['https://www.familysearch.org']);
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const sessionCookie = cookies.find((cookie) => cookie.name === 'fssessionid');
  const anidCookie = cookies.find((cookie) => cookie.name === 'fs_anid');

  if (!sessionCookie?.value || !user) {
    console.error('Login was not detected. Make sure you signed in with your FamilySearch account.');
    await context.close();
    process.exit(1);
  }

  const existing = loadConfig();

  const config = {
    cookies: cookieHeader,
    sessionId: sessionCookie.value,
    fsAnid: anidCookie?.value || existing.fsAnid || '',
    userDisplayName: user.displayName,
    userPersonId: user.personId,
  };

  saveConfig(config);
  console.error(`Signed in as ${user.displayName}${user.personId ? ` (${user.personId})` : ''}.`);
  console.error(`Session saved to ${configPath}`);

  await context.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
