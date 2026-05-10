import { DefaultAdapter } from './DefaultAdapter';
import { ExtractionResult } from './BaseAdapter';
import { Page } from 'playwright';
import { AISelectorHealer } from '../extractors/AISelectorHealer';
import { z } from 'zod';
import { ExtractionValidationError } from '../errors/ExtractionValidationError';

// 1. Define Strict Zod Schema for Twitter Extraction
const TweetSchema = z.object({
  author: z.string().min(1, "Author is required"),
  text: z.string().min(1, "Text is required"),
  timestamp: z.string().min(1, "Timestamp is required")
});

const TwitterExtractionSchema = z.array(TweetSchema).min(1, "At least one tweet is required");

export class TwitterAdapter extends DefaultAdapter {
  protected platform = 'twitter';

  public async extract(page: Page, url: string, options: any): Promise<ExtractionResult> {
    // Call base extraction first (handles stealth network, HTML cleaning, metadata)
    const baseResult = await super.extract(page, url, options);

    // 2. Define Primary and Fallback Selector Strategies
    const selectorStrategies = [
      {
        name: 'Primary (data-testid)',
        container: 'article[data-testid="tweet"]',
        author: '[data-testid="User-Name"]',
        text: '[data-testid="tweetText"]',
        timestamp: 'time'
      },
      {
        name: 'Secondary (cellInnerDiv)',
        container: 'div[data-testid="cellInnerDiv"] [role="article"]',
        author: 'a[role="link"] [dir="ltr"]',
        text: 'div[lang]',
        timestamp: 'time'
      },
      {
        name: 'Tertiary (generic article)',
        container: 'article',
        author: 'div[dir="ltr"] > span',
        text: 'div[data-testid="tweetText"]',
        timestamp: 'a > time'
      }
    ];

    let validTweets: z.infer<typeof TwitterExtractionSchema> | null = null;
    let lastValidationError: Error | null = null;

    // 3. Attempt Extraction and Validation with Fallbacks
    for (const strategy of selectorStrategies) {
      try {
        await page.waitForSelector(strategy.container, { timeout: 5000 });
        
        const extracted = await page.$$eval(strategy.container, (elements, strat) => {
          return elements.map(el => {
            const authorEl = el.querySelector(strat.author);
            const textEl = el.querySelector(strat.text);
            const timeEl = el.querySelector(strat.timestamp);
            
            return {
              author: authorEl?.textContent?.trim() || '',
              text: textEl?.textContent?.trim() || '',
              timestamp: timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || ''
            };
          });
        }, strategy);

        // Zod Validation Check
        validTweets = TwitterExtractionSchema.parse(extracted);
        console.log(`[TwitterAdapter] Successfully extracted and validated using strategy: ${strategy.name}`);
        break; // Valid data found, exit fallback loop
        
      } catch (e: any) {
        if (e instanceof z.ZodError) {
          lastValidationError = e;
          console.log(`[TwitterAdapter] Zod validation failed for strategy ${strategy.name}: ${e.errors.map(err => err.message).join(', ')}`);
        } else {
          lastValidationError = e;
          console.log(`[TwitterAdapter] Selector strategy ${strategy.name} timed out or failed.`);
        }
      }
    }

    // 4. Handle Exhausted Fallbacks
    if (!validTweets) {
      console.log('[TwitterAdapter] All deterministic selectors failed. Triggering AI Self-Healing...');
      try {
        const healedSelector = await AISelectorHealer.healSelector(
          page,
          this.platform,
          'tweet_body',
          'article[data-testid="tweet"]'
        );
        
        await page.waitForSelector(healedSelector, { timeout: 5000 });
        
        const aiExtracted = await page.$$eval(healedSelector, (elements) => {
          return elements.map(el => ({
            author: el.textContent?.substring(0, 20) || 'Unknown Author', // Mapping for arbitrary healed selector
            text: el.textContent || '',
            timestamp: new Date().toISOString()
          }));
        });
        
        validTweets = TwitterExtractionSchema.parse(aiExtracted);
        console.log('[TwitterAdapter] AI Healing extraction successful.');
      } catch (aiError: any) {
        console.log('[TwitterAdapter] AI Healing failed.');
        throw new ExtractionValidationError(`Failed to extract valid Twitter data. DOM changed or blocked. Final Error: ${aiError.message || lastValidationError?.message}`);
      }
    }

    baseResult.extracted_entities = validTweets;
    return baseResult;
  }
}
