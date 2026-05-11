import { BaseAdapter, ExtractionResult } from './BaseAdapter';
import { Page } from 'playwright';
import { ReadabilityExtractor } from '../extractors/ReadabilityExtractor';
import { MetadataExtractor } from '../extractors/MetadataExtractor';
import { MarkdownFormatter } from '../formatters/MarkdownFormatter';
import { DOMCleaner } from '../extractors/DOMCleaner';
import { StealthFetcher } from '../extractors/StealthFetcher';
import * as cheerio from 'cheerio';
import { AuthWallError } from '../errors/AuthWallError';
import { BotChallengeError } from '../errors/BotChallengeError';

export class DefaultAdapter extends BaseAdapter {
  protected platform = 'default';

  public async extract(page: Page, url: string, options: any): Promise<ExtractionResult> {
    const formats = options.formats || ['markdown', 'json'];
    let result: ExtractionResult = { url, platform: this.platform };
    
    // ALTERNATIVE ENTRY: Bypass Datadome
    if (url.includes('reddit.com')) {
      url = url.replace('www.reddit.com', 'old.reddit.com');
    }
    
    let rawHtml = '';
    
    if (!options.forcePlaywright) {
      const fetchResult = await StealthFetcher.fetch(url, options.proxySessionId);
      const isChallenge = [403, 429, 503].includes(fetchResult.statusCode) || 
                          ['cf-browser-verification', 'captcha', 'datadome', 'Access Denied', 'Performing security verification', 'Just a moment...'].some(c => fetchResult.html.includes(c));

      if (fetchResult.statusCode === 200 && !isChallenge) {
        rawHtml = fetchResult.html;
      }
    }

    if (!rawHtml) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      
      // Patient Hydration & Interaction
      if (url.includes('linkedin.com')) {
        await page.waitForSelector('.main-content, .profile-view, #main', { timeout: 10000 }).catch(() => {});
        try {
          // Attempt to click "See more" or "About" to trigger full hydration
          await page.click('button[aria-label*="See more"], .pv-about-section__expand-link', { timeout: 3000 }).catch(() => {});
        } catch (e) {}
      }

      await page.waitForTimeout(2000);
      try {
        await page.mouse.wheel(0, 1000);
        await page.waitForTimeout(3000);
      } catch (e) {}

      rawHtml = await page.content().catch(() => '');
      
      const currentUrl = page.url();
      const isAuthWall = ['/login', '/authwall', 'instagram.com/accounts/login', 'reddit.com/login'].some(p => currentUrl.includes(p));
      const isPlaywrightChallenge = [
        'cf-browser-verification', 'datadome', 'Access Denied', 
        'Performing security verification', 'Just a moment...',
        'Verify you are human', 'Checking your browser',
        'checking if the site connection is secure'
      ].some(c => {
        const found = rawHtml.toLowerCase().includes(c.toLowerCase());
        if (!found) return false;
        // Domain exclusions for false positives
        if (c.toLowerCase() === 'verify you are human' && url.includes('github.com')) return false;
        if (c.toLowerCase() === 'just a moment...' && url.includes('linkedin.com')) return false;
        return true;
      });

      if (isAuthWall) throw new AuthWallError(`Auth Wall detected at ${currentUrl}`);
      if (isPlaywrightChallenge) throw new BotChallengeError(`Bot Challenge detected in Playwright at ${currentUrl}`);
    }
    
    const metadata = MetadataExtractor.extract(rawHtml);
    result.title = metadata.title;
    result.metadata = metadata.all_metadata;

    const cleanedArticle = ReadabilityExtractor.extract(DOMCleaner.cleanContent(rawHtml), url);
    if (cleanedArticle && cleanedArticle.textContent.length > 200 && formats.includes('markdown')) {
      result.markdown = new MarkdownFormatter().format(cleanedArticle.content);
    } else {
      // STRUCTURAL FALLBACK: Manually harvest text if Readability fails
      const $ = cheerio.load(rawHtml);
      $('script, style, nav, footer, header').remove();
      const fallBackText: string[] = [];
      
      // Grab main content blocks & tables (for HackerNews/Reddit)
      $('article, main, .main-content, .profile-view, #main, section, table, .user-profile').each((_, el) => {
        const text = $(el).text().trim().replace(/\s+/g, ' ');
        if (text.length > 10) fallBackText.push(text);
      });

      // If still too short, grab all paragraphs and divs with text
      if (fallBackText.join('\n').length < 100) {
        $('p, div').each((_, el) => {
          const text = $(el).text().trim().replace(/\s+/g, ' ');
          if (text.length > 20) fallBackText.push(text);
        });
      }

      result.markdown = fallBackText.slice(0, 50).join('\n\n') || metadata.description || metadata.title || "No readable content found.";
    }

    return result;
  }
}
