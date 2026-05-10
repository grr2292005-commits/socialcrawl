import { DefaultAdapter } from './DefaultAdapter';
import { ExtractionResult } from './BaseAdapter';
import { Page } from 'playwright';
import { z } from 'zod';
import { ExtractionValidationError } from '../errors/ExtractionValidationError';

// 1. Reliability Update: All fields made optional to support various hydration states
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
      }
    ];

    let validTweets: any[] | null = null;
    let lastError: Error | null = null;

    for (const strategy of selectorStrategies) {
      try {
        await page.waitForSelector(strategy.container, { timeout: 5000 });
        
        const extracted = await page.$$eval(strategy.container, (elements, strat) => {
          return elements.map(el => ({
            author: el.querySelector(strat.author)?.textContent?.trim(),
            text: el.querySelector(strat.text)?.textContent?.trim(),
            timestamp: el.querySelector(strat.timestamp)?.getAttribute('datetime') || el.querySelector(strat.timestamp)?.textContent?.trim()
          }));
        }, strategy);

        validTweets = TwitterExtractionSchema.parse(extracted);
        break;
        
      } catch (e: any) {
        lastError = e;
      }
    }

    if (!validTweets) {
        throw new ExtractionValidationError(`Failed to extract valid Twitter data. Final Error: ${lastError?.message}`);
    }

    baseResult.extracted_entities = validTweets;
    return baseResult;
  }
}
