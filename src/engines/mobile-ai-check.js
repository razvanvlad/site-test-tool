import { chromium, devices } from 'playwright';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

const ai = new GoogleGenAI({});

export async function runMobileCheck(url, timestamp) {
  const findings = [];
  const pixel5 = devices['Pixel 5'];
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...pixel5
  });
  const page = await context.newPage();

  console.log('Mobile Check: Navigating to', url);
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
  } catch (err) {
    console.error('Mobile Check: Failed to load page', err);
    await browser.close();
    return findings;
  }

  // Get bounded boxes of major semantic elements
  const sections = await page.evaluate(() => {
    const selectors = ['header', 'footer', 'main', 'section', 'article', 'nav'];
    const elements = document.querySelectorAll(selectors.join(', '));
    const results = [];
    
    // Fallback: If no semantic elements, just grab the body or divide the page
    if (elements.length === 0) {
      return [{ selector: 'body', bounds: document.body.getBoundingClientRect() }];
    }

    elements.forEach((el, i) => {
      // Create a unique selector for identification
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector += `#${CSS.escape(el.id)}`;
      }
      if (el.className && typeof el.className === 'string') {
        const firstClass = el.className.trim().split(/\s+/)[0];
        if (firstClass) {
          selector += `.${CSS.escape(firstClass)}`;
        }
      }
      
      const bounds = el.getBoundingClientRect();
      // Only capture elements with significant height and width
      if (bounds.width > 50 && bounds.height > 50) {
        results.push({ selector, bounds });
      }
    });
    return results;
  });

  // Limit to at most 4 sections to protect Gemini API quota on free tier
  const sectionsToAnalyze = sections.slice(0, 4);
  console.log(`Mobile Check: Analyzing ${sectionsToAnalyze.length} of ${sections.length} semantic sections.`);

  for (let i = 0; i < sectionsToAnalyze.length; i++) {
    const sec = sectionsToAnalyze[i];
    // Scroll into view to ensure lazy-loaded content renders
    await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (el) el.scrollIntoView();
    }, sec.selector);
    
    await page.waitForTimeout(500); // Give it a moment to settle

    const screenshotPath = path.resolve(process.cwd(), `reports/screenshots/audit-${timestamp}-mobile-sec-${i}.png`);
    const relativePath = `reports/screenshots/audit-${timestamp}-mobile-sec-${i}.png`;

    try {
      const elementHandle = await page.$(sec.selector);
      if (!elementHandle) continue;
      
      await elementHandle.screenshot({ path: screenshotPath });

      // Send to Gemini
      if (process.env.GEMINI_API_KEY) {
        // 3-second throttle delay to avoid 429 Rate Limits
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log(`Mobile Check: Analyzing ${sec.selector}...`);
        
        const prompt = `
You are an expert mobile UX/UI designer and accessibility specialist.
I am providing you a screenshot of a specific section of a website rendered on a mobile device (Pixel 5).

Analyze this section for mobile responsiveness and user experience issues.
Look for:
- Tiny or illegible text
- Elements overlapping awkwardly
- Touch targets (buttons/links) that are too small or too close together
- Horizontal scrolling issues (elements overflowing the viewport width)
- Bad contrast or broken layout

If the section looks perfectly fine and mobile-friendly, return "null".
If you find a noticeable issue, return a JSON object exactly matching this format:
{
  "is_issue": true,
  "title": "Short Title of Issue (e.g. Text too small, Button overflowing)",
  "description": "A 1-2 sentence description of exactly what is wrong and why it is bad for mobile users.",
  "severity": "minor" // choose from: minor, moderate, serious, critical
}

Return ONLY valid JSON. Do not include markdown formatting like \`\`\`json.
`;

        const imageBase64 = fs.readFileSync(screenshotPath, 'base64');
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            prompt,
            { inlineData: { data: imageBase64, mimeType: 'image/png' } }
          ],
        });

        const text = response.text.trim();
        
        if (text !== 'null' && text !== '"null"') {
          try {
            // Remove any potential markdown wrapping
            const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(cleanJson);
            
            if (result.is_issue) {
              findings.push({
                selector: sec.selector,
                title: result.title,
                description: result.description,
                severity: result.severity,
                evidence_path: relativePath
              });
            }
          } catch (e) {
            console.error('Mobile Check: Failed to parse Gemini JSON output', text);
          }
        }
      }
    } catch (e) {
      console.error(`Mobile Check: Failed to screenshot or analyze ${sec.selector}`, e);
    }
  }

  await browser.close();
  return findings;
}
