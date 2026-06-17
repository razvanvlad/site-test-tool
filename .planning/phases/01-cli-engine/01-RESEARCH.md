# Phase 1: CLI Engine - Research

## API Validation & Technical Approach

### 1. Playwright Current API (Node 24 Compatible)
The Playwright API remains stable and is fully compatible with Node 24.
*   **Events**: `page.on('console', msg => ...)` and `page.on('pageerror', err => ...)` are the standard ways to capture console and uncaught exceptions.
*   **Network**: `page.on('requestfailed', req => ...)` and `page.on('response', res => ...)` work reliably.
*   **Screenshot**: `page.screenshot({ path: '...', fullPage: true })` is the standard approach.
*   **Gotcha**: Make sure to use `waitUntil: 'networkidle'` when navigating to capture late-loading resources, but add a fallback timeout so it doesn't hang indefinitely if a site has polling requests.

### 2. Lighthouse Node API
Lighthouse runs via Node and is compatible with Node 24.
*   **Syntax**: It requires `chrome-launcher` to start an instance of Chrome.
*   ```javascript
    import * as chromeLauncher from 'chrome-launcher';
    import lighthouse from 'lighthouse';
    
    const chrome = await chromeLauncher.launch({chromeFlags: ['--headless']});
    const options = {logLevel: 'info', output: 'json', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], port: chrome.port};
    const runnerResult = await lighthouse(url, options);
    await chrome.kill();
    ```
*   **Gotcha**: Lighthouse needs its own Chrome instance (via `chrome-launcher`). It should NOT share the Playwright browser instance, as they compete for the debugging port and can cause unpredictable hangs. Run them sequentially.

### 3. @axe-core/playwright
*   **API**: `import { AxeBuilder } from '@axe-core/playwright';`
*   **Execution**:
    ```javascript
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    ```
*   **Severity**: Axe returns impacts as `minor`, `moderate`, `serious`, and `critical`. This maps perfectly 1:1 with our required severity levels.

### 4. Linkinator
*   **API**:
    ```javascript
    import { LinkChecker } from 'linkinator';
    const checker = new LinkChecker();
    checker.on('link', result => { ... });
    const result = await checker.check({ path: url, recurse: false }); // depth 1
    ```
*   **Gotcha**: 403 and 999 status codes frequently indicate bot protection rather than a truly broken link. These should be flagged appropriately in the findings.

### 5. better-sqlite3
*   **Compatibility**: Works well with Node 24. It uses a synchronous API which is great for this CLI tool.
*   **Gotcha**: Since it has native bindings, it requires a build toolchain (Python, Visual Studio build tools) on Windows. However, pre-built binaries are usually available. If installation fails, it's usually because of missing build tools. Given the environment is Windows 11, we should be prepared for potential compilation if prebuilds for Node 24 aren't ready, though they typically are.

### 6. Integration & Sequencing
*   **Crucial Rule**: Do NOT run Playwright, Lighthouse, and Axe concurrently on the same page.
*   **Optimal Sequence**:
    1.  Start SQLite DB transaction/run entry.
    2.  Run Playwright capture (Network, Console, Screenshot).
    3.  Run Axe-core (can use the same Playwright page before closing it).
    4.  Close Playwright.
    5.  Run Lighthouse (spawns its own Chrome).
    6.  Run Linkinator.
    7.  Normalize and insert all findings into DB.
    8.  Generate JSON report.

## Confidence Level
*   **High**. The architecture is standard and the libraries are well-understood. Node 24 compatibility is good across the board.

## Conclusion
We have everything needed to proceed with planning.
