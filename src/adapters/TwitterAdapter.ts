import { DefaultAdapter } from './DefaultAdapter';
import { ExtractionResult } from './BaseAdapter';
import { Page } from 'playwright';
import { z } from 'zod';
import { ExtractionValidationError } from '../errors/ExtractionValidationError';

const TweetSchema = z.object({
  author: z.string().optional(),
  text: z.string().optional(),
  timestamp: z.string().optional()
});

const TwitterExtractionSchema = z.array(TweetSchema).min(1, "At least one tweet is required");

export class TwitterAdapter extends DefaultAdapter {
  protected platform = 'twitter';

  public async extract(page: Page, url: string, options: any): Promise<ExtractionResult> {
    const baseResult = await super.extract(page, url, options);

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

    for (const strategy of selectorStrategies) {
      try {
        await page.waitForSelector(strategy.container, { timeout: 5000 });
        
        // 1. Logic Fix: Verify variable names in $$eval
        const extracted = await page.$$eval(strategy.container, (elements, strat) => {
          return elements.map(el => {
            const authorEl = el.querySelector(strat.author);
            const textEl = el.querySelector(strat.text);
            const timeEl = el.querySelector(strat.timestamp);
            
            return {
              author: authorEl?.textContent?.trim(),
              text: textEl?.textContent?.trim(),
              timestamp: timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim()
            };
          });
        }, strategy);

        validTweets = TwitterExtractionSchema.parse(extracted);
        console.log(`[TwitterAdapter] Successfully extracted and validated using strategy: ${strategy.name}`);
        break; 
        
      } catch (e: any) {
        lastValidationError = e;
      }
    }

    if (!validTweets) {
      console.log('[TwitterAdapter] All deterministic selectors failed.');
      throw new ExtractionValidationError(`Failed to extract valid Twitter data. DOM changed or blocked. Final Error: ${lastValidationError?.message}`);
    }

    baseResult.extracted_entities = validTweets;
    return baseResult;
  }
}
