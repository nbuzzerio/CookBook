import { chromium } from '@playwright/test';

export function localURL(port) {
  const url = new URL(process.env.COUNTERTOP_URL || `http://127.0.0.1:${port}/`);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Countertop synthetic browser tests require a loopback origin.');
  }
  return url.href;
}

export function launchBrowser() {
  const pin = process.env.COUNTERTOP_TEST_CERT_PIN;
  return chromium.launch({
    channel: process.platform === 'win32' ? 'chrome' : undefined,
    args: pin ? [`--ignore-certificate-errors-spki-list=${pin}`] : [],
  });
}
