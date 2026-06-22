import { chromium } from 'playwright';

export async function captureSignals(url, page, options = {}) {
  const consoleErrors = [];
  const failedRequests = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const location = msg.location();
      consoleErrors.push({
        text: msg.text(),
        url: location.url || null,
        line: location.lineNumber || null
      });
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push({
      text: String(err),
      url: page.url(),
      line: null
    });
  });

  page.on('requestfailed', req => {
    failedRequests.push({
      url: req.url(),
      err: req.failure()?.errorText
    });
  });

  page.on('response', res => {
    if (res.status() >= 400) {
      failedRequests.push({
        url: res.url(),
        status: res.status()
      });
    }
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (error) {
    consoleErrors.push({
      text: `Navigation error: ${error.message}`,
      url,
      line: null
    });
  }

  const screenshotPath = options.screenshotPath || `reports/screenshots/temp.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });

  return { consoleErrors, failedRequests };
}
