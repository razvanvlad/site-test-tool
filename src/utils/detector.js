/**
 * Detects the technologies used on a web page by analyzing its HTML content.
 * @param {string} html 
 * @returns {string[]} Array of detected technology tags
 */
export function detectTechStack(html) {
  if (!html) return [];
  
  const tags = new Set();
  
  // WordPress
  if (html.includes('/wp-content/') || html.includes('/wp-includes/') || html.includes('wp-json')) {
    tags.add('wordpress');
  }
  
  // Next.js
  if (html.includes('__NEXT_DATA__') || html.includes('_next/static')) {
    tags.add('nextjs');
    tags.add('react');
  }
  
  // React (generic)
  if (html.includes('data-reactroot') || html.includes('react.development.js') || html.includes('react.production.min.js')) {
    tags.add('react');
  }
  
  // Shopify
  if (html.includes('cdn.shopify.com') || html.includes('Shopify.theme') || html.includes('shopify-payment-button')) {
    tags.add('shopify');
  }
  
  // Tailwind CSS
  if (html.includes('tailwind.min.css') || /class="[^"]*(sm:|md:|lg:|xl:|hover:|focus:|dark:|bg-|text-|flex-|grid-)/.test(html)) {
    tags.add('tailwind');
  }
  
  // Bootstrap
  if (html.includes('bootstrap.min.css') || html.includes('bootstrap.css') || html.includes('bootstrap.min.js')) {
    tags.add('bootstrap');
  }
  
  // jQuery
  if (html.includes('jquery.min.js') || html.includes('jquery.js') || html.includes('/jquery/')) {
    tags.add('jquery');
  }
  
  return Array.from(tags);
}
