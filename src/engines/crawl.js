import { LinkChecker } from 'linkinator';

export async function crawlSite(baseUrl) {
  try {
    const checker = new LinkChecker();
    // recurse: true crawls the entire site
    const result = await checker.check({ path: baseUrl, recurse: true });
    
    const urlObj = new URL(baseUrl);
    const origin = urlObj.origin;
    
    const pages = new Set();
    
    for (const link of result.links) {
      // Only include successful internal links that don't look like static assets
      if (link.status === 200 && link.url.startsWith(origin)) {
        if (!link.url.match(/\.(png|jpg|jpeg|gif|css|js|woff|woff2|ttf|svg|pdf|zip|mp4)$/i)) {
          // Remove hash fragments
          const cleanUrl = link.url.split('#')[0];
          pages.add(cleanUrl);
        }
      }
    }
    
    return Array.from(pages);
  } catch (error) {
    console.error('Crawl execution failed:', error);
    return [];
  }
}
