// Shared helpers for the Playwright scripts (login, film listing, downloads).
import { existsSync, readFileSync } from 'fs';
import { homedir, platform } from 'os';
import { isAbsolute, join, relative, resolve } from 'path';

export const configDir = join(homedir(), '.familysearch-mcp');
export const configPath = join(configDir, 'config.json');

const BROWSER_PATHS = {
  darwin: [
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/brave-browser',
    '/usr/bin/brave',
    '/snap/bin/brave',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ],
  win32: [
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Google/Chrome/Application/chrome.exe'),
  ],
};

export function findBrowserExecutable() {
  const configuredPath = process.env.FAMILYSEARCH_BROWSER_PATH || process.env.BRAVE_PATH;
  if (configuredPath && existsSync(configuredPath)) return configuredPath;
  return (BROWSER_PATHS[platform()] || []).find((path) => existsSync(path)) || null;
}

export const BROWSER_LAUNCH_OPTIONS = {
  headless: false,
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
};

export function loadCookies() {
  if (!existsSync(configPath)) throw new Error('FamilySearch session config not found. Run login-with-browser first.');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const cookies = String(config.cookies || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf('=');
      return {
        name: part.slice(0, separator),
        value: part.slice(separator + 1),
        domain: '.familysearch.org',
        path: '/',
        secure: true,
      };
    })
    .filter((cookie) => cookie.name && cookie.value);
  if (!cookies.length) throw new Error('No FamilySearch cookies found. Run login-with-browser first.');
  return cookies;
}

// Downloads always land inside one folder. The AI picks file names and
// sub-folders from tool calls, and tool results include OCR text from old
// documents, so a path the model was talked into must not escape it.
export const downloadRoot = resolve(
  process.env.FAMILYSEARCH_DOWNLOAD_DIR || join(homedir(), 'Downloads', 'familysearch-mcp'),
);

export function resolveDownloadDirectory(requested) {
  if (!requested) return downloadRoot;
  const target = resolve(downloadRoot, String(requested));
  const rel = relative(downloadRoot, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `outputDirectory must be a folder inside ${downloadRoot} (set FAMILYSEARCH_DOWNLOAD_DIR to change the root).`,
    );
  }
  return target;
}

export function isFamilySearchUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'familysearch.org' || url.hostname.endsWith('.familysearch.org'));
  } catch {
    return false;
  }
}
