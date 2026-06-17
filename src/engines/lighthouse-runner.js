import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

export async function runLighthouse(url) {
  let chrome;
  try {
    chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
    const options = {
      logLevel: 'error',
      output: 'json',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      port: chrome.port
    };
    
    const runnerResult = await lighthouse(url, options);
    
    try {
      await chrome.kill();
    } catch (e) {}
    
    return { lhr: runnerResult.lhr };
  } catch (error) {
    if (chrome) {
      try { await chrome.kill(); } catch (e) {}
    }
    console.error('Lighthouse execution failed:', error);
    return { error: error.message };
  }
}
