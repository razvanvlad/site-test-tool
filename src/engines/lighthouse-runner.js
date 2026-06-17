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
    
    await chrome.kill();
    return { lhr: runnerResult.lhr };
  } catch (error) {
    if (chrome) {
      await chrome.kill();
    }
    console.error('Lighthouse execution failed:', error);
    return { error: error.message };
  }
}
