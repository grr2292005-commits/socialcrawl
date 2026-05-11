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
      // 1. Navigation with adaptive waiting
      const navigationTimeout = 30000;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout }).catch(() => {});
      
      // 2. Platform-Specific Hydration
      if (url.includes('linkedin.com')) {
        await page.waitForSelector('.main-content, .profile-view, #main', { timeout: 10000 }).catch(() => {});
        try {
          await page.click('button[aria-label*="See more"], .pv-about-section__expand-link', { timeout: 3000 }).catch(() => {});
        } catch (e) {}
      } else if (url.includes('reddit.com')) {
        await page.waitForSelector('.usertext, .content, #header-bottom-left, .Post, .thing, .sitetable', { timeout: 10000 }).catch(() => {});
        // Handle "Mature Content" or "Use App" interstitials
        try {
          await page.click('button:has-text("Yes"), button:has-text("Continue"), .action-button', { timeout: 3000 }).catch(() => {});
        } catch (e) {}
      } else if (url.includes('github.com')) {
        await page.waitForSelector('.vcard-names, .repository-content, .markdown-body', { timeout: 10000 }).catch(() => {});
      } else if (url.includes('medium.com')) {
        await page.waitForSelector('article, [data-testid="author-name"]', { timeout: 10000 }).catch(() => {});
      }

      // 3. Human-like interaction
      await page.waitForTimeout(2000);
      try {
        await page.mouse.wheel(0, 750);
        await page.waitForTimeout(1000);
        await page.mouse.wheel(0, 750);
        await page.waitForTimeout(2000);
      } catch (e) {}

      rawHtml = await page.content().catch(() => '');
      
      const currentUrl = page.url();
      const isAuthWall = ['/login', '/authwall', 'instagram.com/accounts/login', 'reddit.com/login'].some(p => currentUrl.includes(p));
      
      // 4. LOOSENED CHALLENGE DETECTION: Only match true WAFs/Blocks
      const isPlaywrightChallenge = [
        'cf-browser-verification', 'datadome',
        'Performing security verification', 'Verify you are human',
        'checking if the site connection is secure',
        'blocked by network security',
        'out of nothing, something'
      ].some(c => {
        const found = rawHtml.toLowerCase().includes(c.toLowerCase());
        if (!found) return false;
        
        // Domain exclusions for false positives
        if (c.toLowerCase() === 'verify you are human' && url.includes('github.com')) return false;
        if (url.includes('linkedin.com') || url.includes('youtube.com') || url.includes('instagram.com') || url.includes('github.com') || url.includes('reddit.com')) {
          // If we have dense content, ignore transient WAF strings
          if (rawHtml.length > 5000) return false;
        }
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

    // AUTONOMOUS SPIDERING: Link Extraction
    if (options.isCrawl) {
      const $ = cheerio.load(rawHtml);
      const internalLinks = new Set<string>();
      const baseUrl = new URL(url);
      
      $('a[href]').each((_, el) => {
        try {
          const href = $(el).attr('href');
          if (!href) return;
          
          const absoluteUrl = new URL(href, url);
          // Only same root domain, exclude anchors and non-http
          if (absoluteUrl.hostname === baseUrl.hostname && absoluteUrl.protocol.startsWith('http')) {
            const cleanUrl = absoluteUrl.origin + absoluteUrl.pathname + absoluteUrl.search;
            if (cleanUrl !== url) internalLinks.add(cleanUrl);
          }
        } catch (e) {}
      });
      
      result.internal_links = Array.from(internalLinks);
    }

    return result;
  }
}
