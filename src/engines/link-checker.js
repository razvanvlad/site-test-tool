import { LinkChecker } from 'linkinator';

export async function checkLinks(url) {
  try {
    const checker = new LinkChecker();
    const result = await checker.check({ path: url, recurse: false });
    
    return result.links.filter(link => link.state === 'BROKEN');
  } catch (error) {
    console.error('Linkinator execution failed:', error);
    return [];
  }
}
