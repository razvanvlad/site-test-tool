import { chromium } from 'playwright';

export async function discoverLayout(url) {
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const layoutAreas = await page.evaluate(() => {
      const areas = [];
      if (document.querySelector('header')) areas.push('header');
      if (document.querySelector('footer')) areas.push('footer');
      if (document.querySelector('main')) areas.push('main');
      if (document.querySelector('nav')) areas.push('nav');
      if (document.querySelector('aside')) areas.push('aside');
      
      // Also grab major sections with IDs
      document.querySelectorAll('section[id]').forEach(sec => {
         areas.push(`section#${sec.id}`);
      });
      return areas;
    });
    
    return layoutAreas;
  } catch (err) {
    console.error('Layout discovery failed:', err);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}
