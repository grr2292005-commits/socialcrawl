import { Page } from 'playwright';
import { DOMCleaner } from './DOMCleaner';
import { GoogleGenAI } from '@google/genai';
import IORedis from 'ioredis';

// Initialize Redis for caching healed selectors
const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

// Initialize Gemini SDK
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || 'dummy-key',
});

export class AISelectorHealer {
  /**
   * Attempts to self-heal a broken selector by analyzing the page DOM and screenshot using Gemini.
   * Caches successful healing results in Redis for 7 days.
   * 
   * @param page The Playwright Page object.
   * @param platform The platform name (e.g., 'twitter').
   * @param targetDescription A description of what the selector is supposed to target (e.g., 'tweet_body').
   * @param brokenSelector The original CSS selector that failed.
   * @returns The healed CSS selector.
   */
  public static async healSelector(
    page: Page,
    platform: string,
    targetDescription: string,
    brokenSelector: string
  ): Promise<string> {
    const cacheKey = `selector:${platform}:${targetDescription}`;

    // 1. Check if we already have a healed selector cached
    try {
      const cachedSelector = await redis.get(cacheKey);
      if (cachedSelector) {
        console.log(`[Healer] Using cached selector for ${platform}:${targetDescription} -> ${cachedSelector}`);
        return cachedSelector;
      }
    } catch (e) {
      console.error('[Healer] Redis cache read error:', e);
    }

    console.log(`[Healer] Initiating AI self-healing for ${platform}:${targetDescription}. Original: ${brokenSelector}`);

    // 2. Extract DOM and Screenshot
    const rawHtml = await page.content();
    const cleanedHtml = DOMCleaner.cleanContent(rawHtml);
    
    // Convert screenshot to base64 for Gemini multimodal input
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const base64Screenshot = screenshotBuffer.toString('base64');

    // 3. Prompt Gemini to find the new selector
    const prompt = `
      You are an expert web scraper and DOM analysis engineer.
      The previous CSS selector "${brokenSelector}" for the platform "${platform}" targeting "${targetDescription}" is no longer working.
      I have provided a screenshot of the viewport and the cleaned HTML DOM structure.
      
      Task: Identify the correct, robust CSS selector for "${targetDescription}".
      Requirements:
      - Return ONLY the raw CSS selector string.
      - Do not wrap it in markdown code blocks.
      - Ensure the selector is as resilient as possible (prefer data-testid, aria-labels, or structural paths over dynamic utility classes).
      
      Cleaned HTML:
      \`\`\`html
      ${cleanedHtml.substring(0, 15000)} <!-- Truncated to avoid token limits -->
      \`\`\`
    `;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: [
          prompt,
          {
            inlineData: {
              data: base64Screenshot,
              mimeType: 'image/png',
            },
          },
        ],
        config: {
            temperature: 0.1
        }
      });

      let healedSelector = response.text?.trim() || '';
      
      // Cleanup any accidental markdown from the LLM
      if (healedSelector.startsWith('\`\`\`')) {
         healedSelector = healedSelector.replace(/\`\`\`css/g, '').replace(/\`\`\`/g, '').trim();
      }

      if (!healedSelector) {
        throw new Error('Gemini returned an empty selector.');
      }

      console.log(`[Healer] Successfully healed selector: ${healedSelector}`);

      // 4. Cache the healed selector for 7 days (604800 seconds)
      try {
        await redis.setex(cacheKey, 604800, healedSelector);
      } catch (e) {
        console.error('[Healer] Redis cache write error:', e);
      }

      return healedSelector;
    } catch (e) {
      console.error('[Healer] AI healing process failed:', e);
      // Fallback to the original selector if healing fails
      return brokenSelector;
    }
  }
}
