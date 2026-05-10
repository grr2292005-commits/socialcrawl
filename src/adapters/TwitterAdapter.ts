import { DefaultAdapter } from './DefaultAdapter';
import { ExtractionResult } from './BaseAdapter';
import { Page } from 'playwright';

export class TwitterAdapter extends DefaultAdapter {
  protected platform = 'twitter';

  public async extract(page: Page, url: string, options: any): Promise<ExtractionResult> {
    // Wait for the timeline to load if available, or just fallback to default wait
    try {
      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 5000 });
    } catch (e) {
      console.log('No tweet article found within timeout, falling back to default extraction.');
    }

    // Call base extraction first
    const baseResult = await super.extract(page, url, options);

    // Add Twitter-specific extractions here
    // e.g. extracting specific tweets or metrics
    const tweets = await page.$$eval('article[data-testid="tweet"]', (elements) => {
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
