/**
 * ai-router.js
 * Central AI routing for the Site Test Tool.
 * Supports: Gemini 2.5 Flash (via @google/genai) and Groq (via groq.com OpenAI-compatible REST API).
 * Auto-falls back to Groq when Gemini returns a 429 quota error.
 *
 * Groq free tier: https://console.groq.com
 * Model used: llama-3.3-70b-versatile (high quality, fast, generous free limits)
 */

import { GoogleGenAI } from '@google/genai';
import https from 'https';

// ── State ─────────────────────────────────────────────────────────────────────

/**
 * Quota state per model.
 * { gemini: { exhausted: bool, resetAt: Date|null }, groq: { exhausted: bool, resetAt: Date|null } }
 */
export const quotaState = {
  gemini: { exhausted: false, resetAt: null },
  groq:   { exhausted: false, resetAt: null },
};

let geminiInstance = null;
function getGeminiClient() {
  if (!geminiInstance) {
    geminiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiInstance;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Determines if an error is a quota / rate-limit error.
 */
function isQuotaError(err) {
  const msg = (err?.message || '').toLowerCase();
  const status = err?.status || err?.code || 0;
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('resource_exhausted') ||
    msg.includes('ratelimitexceeded') ||
    msg.includes('tokens per') ||
    msg.includes('requests per')
  );
}

// ── Groq (groq.com) OpenAI-compatible call ────────────────────────────────────

/**
 * Calls Groq's chat completions endpoint (OpenAI-compatible).
 * Uses llama-3.3-70b-versatile — excellent quality, very fast, generous free tier.
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {boolean} jsonMode - if true, requests JSON output
 * @returns {Promise<string>} text response
 */
export async function callGroq(systemPrompt, userMessage, jsonMode = false) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured in .env');

  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage }
    ],
    temperature: 0.3,
    max_tokens: 4096,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        }
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 429) {
            quotaState.groq.exhausted = true;
            quotaState.groq.resetAt = new Date(Date.now() + 60 * 60 * 1000); // reset hint: 1 hour
            return reject(Object.assign(new Error('Groq rate limit hit (429)'), { status: 429 }));
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Groq API error ${res.statusCode}: ${data}`));
          }
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.choices?.[0]?.message?.content || '');
          } catch (e) {
            reject(new Error('Failed to parse Groq response: ' + data));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Gemini call ────────────────────────────────────────────────────────────────

/**
 * Calls Gemini 2.5 Flash with the given prompt (single string).
 * @param {string} prompt
 * @param {boolean} jsonMode
 * @returns {Promise<string>}
 */
export async function callGemini(prompt, jsonMode = false) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');

  const config = jsonMode ? { responseMimeType: 'application/json' } : {};
  const response = await getGeminiClient().models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config
  });

  // If we get here, Gemini responded successfully → clear exhausted flag
  if (quotaState.gemini.exhausted) {
    quotaState.gemini.exhausted = false;
    quotaState.gemini.resetAt = null;
  }

  return response.text;
}

// ── Router ─────────────────────────────────────────────────────────────────────

/**
 * Calls the preferred AI model with automatic fallback.
 *
 * @param {object} options
 * @param {string} options.prompt          - Full prompt string. For Groq: used as the user message.
 * @param {string} [options.systemPrompt]  - System role prompt (prepended to Gemini prompt; used as system msg for Groq).
 * @param {boolean} [options.jsonMode]     - Request JSON-formatted output.
 * @param {'gemini'|'groq'|'auto'} [options.preferredModel='auto'] - Which model to prefer.
 * @returns {Promise<{ text: string, modelUsed: string }>}
 */
export async function callAI({ prompt, systemPrompt = null, jsonMode = false, preferredModel = 'auto' }) {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasGroq   = !!process.env.GROQ_API_KEY;

  // Build the ordered list of models to try
  let order = [];

  if (preferredModel === 'groq') {
    order = ['groq', 'gemini'];
  } else if (preferredModel === 'gemini') {
    order = ['gemini', 'groq'];
  } else {
    // auto: prefer Gemini unless it's exhausted
    order = quotaState.gemini.exhausted ? ['groq', 'gemini'] : ['gemini', 'groq'];
  }

  let lastError = null;

  for (const model of order) {
    if (model === 'gemini' && !hasGemini) continue;
    if (model === 'groq'   && !hasGroq)   continue;
    if (model === 'gemini' && quotaState.gemini.exhausted && preferredModel !== 'gemini') continue;
    if (model === 'groq'   && quotaState.groq.exhausted   && preferredModel !== 'groq')   continue;

    try {
      if (model === 'gemini') {
        const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
        const text = await callGemini(fullPrompt, jsonMode);
        return { text, modelUsed: 'gemini' };
      } else {
        const sys = systemPrompt || 'You are a helpful expert developer assistant.';
        const text = await callGroq(sys, prompt, jsonMode);
        return { text, modelUsed: 'groq' };
      }
    } catch (err) {
      lastError = err;
      if (isQuotaError(err)) {
        if (model === 'gemini') {
          console.error('[AI Router] Gemini quota exhausted, marking as unavailable. Trying Groq...');
          quotaState.gemini.exhausted = true;
          quotaState.gemini.resetAt = new Date(Date.now() + 60 * 60 * 1000);
        } else {
          console.error('[AI Router] Groq rate limit hit, marking as unavailable.');
          quotaState.groq.exhausted = true;
          quotaState.groq.resetAt = new Date(Date.now() + 60 * 60 * 1000);
        }
        // Try next model in the order
        continue;
      }
      // Non-quota error: propagate immediately
      throw err;
    }
  }

  throw lastError || new Error('No AI model available. Check your API keys and quotas in .env');
}
