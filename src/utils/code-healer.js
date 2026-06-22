import fs from 'fs';
import path from 'path';
import { callAI } from './ai-router.js';

/**
 * Recursively walks a directory and gathers file paths matching common web extensions.
 * @param {string} dir 
 * @param {string[]} fileList 
 * @returns {string[]}
 */
function walkDir(dir, fileList = []) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      // Ignore common build/version folders
      if (['node_modules', '.git', 'dist', 'build', '.next', 'reports'].includes(file)) continue;
      
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        walkDir(filePath, fileList);
      } else {
        const ext = path.extname(file).toLowerCase();
        if (['.html', '.css', '.js', '.jsx', '.tsx', '.vue', '.php', '.twig'].includes(ext)) {
          fileList.push(filePath);
        }
      }
    }
  } catch (e) {
    console.error('Walk error:', e);
  }
  return fileList;
}

/**
 * Searches local files for the target HTML snippet or selector class/ID names.
 * @param {string} localPath 
 * @param {object} finding 
 * @returns {object|null} { filePath, content }
 */
export function findMatchingFile(localPath, finding) {
  if (!localPath || !fs.existsSync(localPath)) return null;

  const files = walkDir(localPath);
  
  // 1. Try exact match of HTML snippet if available (checking both standard HTML class and React className)
  if (finding.html_snippet) {
    const cleanSnippet = finding.html_snippet.trim();
    const reactSnippet = cleanSnippet.replace(/\bclass="/g, 'className="');
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes(cleanSnippet) || content.includes(reactSnippet)) {
          return { filePath: file, content };
        }
      } catch (e) {}
    }
  }
  
  // 2. Try matching based on selector class or ID
  if (finding.selector) {
    // Extract ID if available
    const idMatch = finding.selector.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      const term = idMatch[1];
      for (const file of files) {
        try {
          const content = fs.readFileSync(file, 'utf8');
          if (content.includes(term)) {
            return { filePath: file, content };
          }
        } catch (e) {}
      }
    }

    // Extract all classes from the selector
    const classes = [...finding.selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map(m => m[1]);
    
    // Filter out common Tailwind/CSS utility classes to find specific ones
    const commonUtilities = ['flex', 'grid', 'hidden', 'block', 'relative', 'absolute', 'fixed', 'gap', 'hover', 'items', 'justify', 'text', 'bg', 'p', 'px', 'py', 'm', 'mx', 'my', 'w', 'h', 'rounded', 'border', 'font', 'tracking'];
    const specificClasses = classes.filter(cls => !commonUtilities.some(util => cls === util || cls.startsWith(util + '-')));
    
    // Try matching specific classes first
    const terms = specificClasses.length > 0 ? specificClasses : classes;
    
    for (const term of terms) {
      if (term.length < 3) continue; // Skip too short terms
      for (const file of files) {
        try {
          const content = fs.readFileSync(file, 'utf8');
          if (content.includes(term)) {
            return { filePath: file, content };
          }
        } catch (e) {}
      }
    }
  }
  
  // 3. Fallback: return the first stylesheet if it's a CSS contrast or design issue
  if (finding.category === 'accessibility' || finding.category === 'design') {
    const cssFile = files.find(f => f.endsWith('.css'));
    if (cssFile) {
      try {
        return { filePath: cssFile, content: fs.readFileSync(cssFile, 'utf8') };
      } catch (e) {}
    }
  }
  
  return null;
}

/**
 * Calls Gemini to propose a code fix for the target finding.
 * @param {object} finding 
 * @param {object|null} fileContext { filePath, content }
 * @returns {promise<object>} Proposed fix JSON
 */
export async function proposeFix(finding, fileContext = null, preferredModel = 'auto') {
  if (!process.env.GEMINI_API_KEY && !process.env.XAI_API_KEY) {
    throw new Error('No AI API key configured (GEMINI_API_KEY or XAI_API_KEY).');
  }

  const hasContext = fileContext && fileContext.filePath;
  const fileName = hasContext ? path.basename(fileContext.filePath) : 'Generic';

  const systemPrompt = 'You are an expert developer specializing in code remediation, accessibility (WCAG), and responsive CSS. Always respond with valid JSON only — no markdown, no code fences.';

  const prompt = `Analyze this audit finding:

Tool: ${finding.source_tool}
Category: ${finding.category}
Severity: ${finding.severity}
Issue: ${finding.title}
Description: ${finding.description}
Selector: ${finding.selector || 'N/A'}
HTML Snippet: ${finding.html_snippet || 'N/A'}

${hasContext ? `We found a matching local source file: "${fileName}"
File Path: ${fileContext.filePath}

Target File Contents:
\`\`\`
${fileContext.content}
\`\`\`

Propose the exact modification to apply to this file to resolve the issue.` : `We do not have a local source file context for this website. Propose a generic CSS/JS/HTML patch to resolve it.`}

You MUST respond with a JSON object of this structure:
{
  "has_file_fix": ${hasContext ? 'true' : 'false'},
  "file_path": ${hasContext ? `"${fileContext.filePath.replace(/\\/g, '\\\\')}"` : 'null'},
  "original_code": "The exact contiguous block of lines from the file contents to be replaced. MUST MATCH EXACTLY WITH WHITESPACE.",
  "replacement_code": "The updated block of code to replace the original_code with.",
  "explanation": "Brief explanation of what the fix does."
}

Return ONLY valid JSON.`;

  const { text, modelUsed } = await callAI({ prompt, systemPrompt, jsonMode: true, preferredModel });

  try {
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanJson);
    result._modelUsed = modelUsed;
    return result;
  } catch (err) {
    console.error('Failed to parse propose-fix output:', text);
    throw new Error('AI proposed an invalid fix format.');
  }
}
