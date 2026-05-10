import { DefaultAdapter } from './DefaultAdapter';
import { ExtractionResult } from './BaseAdapter';
import { Page } from 'playwright';
import { AISelectorHealer } from '../extractors/AISelectorHealer';

export class TwitterAdapter extends DefaultAdapter {
  protected platform = 'twitter';

  public async extract(page: Page, url: string, options: any): Promise<ExtractionResult> {
    let tweetSelector = 'article[data-testid="tweet"]';

    // Wait for the timeline to load if available, or fallback to healing
    try {
      await page.waitForSelector(tweetSelector, { timeout: 5000 });
    } catch (e) {
      console.log('Original tweet selector failed. Triggering AI Self-Healing...');
      try {
        tweetSelector = await AISelectorHealer.healSelector(
          page,
          this.platform,
          'tweet_body',
          tweetSelector
        );
        // Retry with the healed selector
        await page.waitForSelector(tweetSelector, { timeout: 5000 });
      } catch (healingError) {
        console.log('AI Healing also failed or timed out. Falling back to default extraction.');
      }
    }

    // Call base extraction first
    const baseResult = await super.extract(page, url, options);

    // Add Twitter-specific extractions here using the potentially healed selector
    const tweets = await page.$$eval(tweetSelector, (elements) => {
      return elements.map(el => {
        const text = el.textContent || '';
        return { text };
      });
    });

    if (tweets.length > 0) {
      baseResult.extracted_entities = tweets;
    }

    return baseResult;
  }
}
