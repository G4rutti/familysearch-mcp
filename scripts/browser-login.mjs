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

const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Older FamilySearch builds kept the signed-in user in a localStorage key
// ending in "-v3-user". Read it when present, but never depend on it.
async function readUserFromLocalStorage(context) {
  for (const page of context.pages()) {
    try {
      if (!page.url().startsWith('https://www.familysearch.org')) continue;
      const user = await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (!/user/i.test(key)) continue;
          try {
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            const user = data.user || data;
            if (user?.cisId || user?.personId) {
              return { displayName: user.displayName || user.contactName || '', personId: user.personId || '' };
            }
          } catch {
            // not JSON
          }
        }
        return null;
      });
      if (user) return user;
    } catch {
      // page navigating or closed
    }
  }
  return null;
}

// Ask FamilySearch who the session belongs to. This is the reliable signal:
// it only succeeds once the login has really finished.
async function readUserFromApi(context, sessionId) {
  try {
    const response = await context.request.get('https://www.familysearch.org/platform/users/current', {
      headers: { Accept: 'application/x-fs-v1+json', Authorization: `Bearer ${sessionId}` },
      failOnStatusCode: false,
    });
    if (!response.ok()) return null;
    const data = await response.json();
    const user = data?.users?.[0];
    if (!user) return null;
    return { displayName: user.displayName || user.contactName || '', personId: user.personId || '' };
  } catch {
    return null;
  }
}

// Same check from inside an open familysearch.org tab, in case bot
// protection treats the out-of-page request differently from the browser.
async function readUserFromPage(context, sessionId) {
  for (const page of context.pages()) {
    try {
      if (!page.url().startsWith('https://www.familysearch.org')) continue;
      const user = await page.evaluate(async (token) => {
        const response = await fetch('/platform/users/current', {
          headers: { Accept: 'application/x-fs-v1+json', Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
        if (!response.ok) return null;
        const data = await response.json();
        const user = data?.users?.[0];
        return user ? { displayName: user.displayName || user.contactName || '', personId: user.personId || '' } : null;
      }, sessionId);
      if (user) return user;
    } catch {
      // page navigating or closed
    }
  }
  return null;
}

async function waitForLogin(context) {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let lastSession = '';
  while (Date.now() < deadline) {
    const cookies = await context.cookies(['https://www.familysearch.org']).catch(() => []);
    const session = cookies.find((cookie) => cookie.name === 'fssessionid')?.value;
    if (session) {
      const user =
        (await readUserFromApi(context, session)) ||
        (await readUserFromPage(context, session)) ||
        (await readUserFromLocalStorage(context));
      if (user) return { user, cookies, sessionId: session };
      if (session !== lastSession) {
        console.error('Session cookie found; waiting for FamilySearch to confirm the login...');
        lastSession = session;
      }
    }
    await sleep(POLL_MS);
  }
  return null;
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

  const login = await waitForLogin(context);
  if (!login) {
    console.error('Timed out waiting for login. Sign in at familysearch.org in the window that opened, then run npm run login again.');
    await context.close();
    process.exit(1);
  }

  const { cookies, sessionId } = login;
  const user = { displayName: login.user.displayName || 'FamilySearch user', personId: login.user.personId };
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const anidCookie = cookies.find((cookie) => cookie.name === 'fs_anid');

  const existing = loadConfig();

  const config = {
    cookies: cookieHeader,
    sessionId,
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
