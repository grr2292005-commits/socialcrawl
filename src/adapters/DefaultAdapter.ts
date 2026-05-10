import { BaseAdapter, ExtractionResult } from './BaseAdapter';
import { Page } from 'playwright';
import { ReadabilityExtractor } from '../extractors/ReadabilityExtractor';
import { MetadataExtractor } from '../extractors/MetadataExtractor';
import { MarkdownFormatter } from '../formatters/MarkdownFormatter';
import { SemanticChunker } from '../chunkers/SemanticChunker';
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
    let rawHtml = '';
    let usedPlaywright = false;

    // 0. Attempt Stealth Fetch First
    if (!options.forcePlaywright) {
      console.log(`[Adapter] Attempting stealth fetch for ${url}`);
      const fetchResult = await StealthFetcher.fetch(url, options.proxySessionId);

      const isChallenge = fetchResult.statusCode === 403 || 
                          fetchResult.statusCode === 429 || 
                          fetchResult.statusCode === 503 || 
                          fetchResult.html.includes('cf-browser-verification') || 
                          fetchResult.html.includes('captcha') ||
                          fetchResult.html.includes('datadome') ||
                          fetchResult.html.includes('Verify you are human') ||
                          fetchResult.html.includes('Access Denied') ||
                          fetchResult.html.includes('Checking your browser') ||
                          fetchResult.html.includes('Access to this page has been denied') ||
                          fetchResult.html.includes('Checking if the site connection is secure') ||
                          fetchResult.html.includes('Just a moment...') ||
                          fetchResult.html.includes('Checking your browser') ||
                          (url.includes('ycombinator') && fetchResult.html.includes('Sorry.'));

      if (isChallenge) {
        console.log(`[Adapter] Bot Challenge detected in stealth fetch.`);
        // 3. Throwing Logic: If isChallenge is detected, throw BotChallengeError immediately
        throw new BotChallengeError(`Bot Challenge detected at ${url}`);
      }

      let isSparseSPA = false;
      const $ = cheerio.load(fetchResult.html);
      $('script, style, svg').remove();
      const textContentLength = $('body').text().replace(/\s+/g, ' ').trim().length;
      const hasSPAMounts = fetchResult.html.includes('id="root"') || 
                           fetchResult.html.includes('id="__next"') || 
                           fetchResult.html.includes('id="app"') || 
                           fetchResult.html.includes('<yt-root>') ||
                           fetchResult.html.includes('<app-root>');

      if (fetchResult.statusCode === 200 && (textContentLength < 500 || hasSPAMounts)) {
        isSparseSPA = true;
      }

      if (fetchResult.statusCode === 200 && !isSparseSPA) {
        rawHtml = fetchResult.html;
      }
    }

    if (!rawHtml) {
      usedPlaywright = true;
      
      if (page.url() === 'about:blank' || page.url() !== url) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        if (url.includes('reddit.com') || url.includes('youtube.com')) {
          console.log(`[Adapter] Dynamic waiting for ${url}...`);
          await Promise.race([
            page.waitForSelector('main', { timeout: 8000 }),
            page.waitForSelector('#content', { timeout: 8000 }),
            page.waitForTimeout(5000)
          ]).catch(() => {});
        } else {
          const content = await page.content();
          const isSparse = content.length < 5000 || content.includes('id="root"') || content.includes('id="__next"');
          if (isSparse) {
            await page.waitForTimeout(5000);
          }
        }
      }

      const currentUrl = page.url();
      
      // 1. Fix Race Condition: Wrap rawHtml = await page.content(); in a retry block
      try {
        rawHtml = await page.content();
      } catch (error: any) {
        if (error.message.includes('navigation') || error.message.includes('closed')) {
          console.log('[Adapter] Navigation error during content fetch. Retrying in 3s...');
          await page.waitForTimeout(3000); // Wait 3 seconds as requested
          rawHtml = await page.content();
        } else {
          throw error;
        }
      }
      
      // Robust Auth Wall Detection
      const isAuthWall = currentUrl.includes('/login') || 
                         currentUrl.includes('/authwall') || 
                         currentUrl.includes('/signup') ||
                         currentUrl.includes('instagram.com/accounts/login') ||
                         currentUrl.includes('reddit.com/login') ||
                         currentUrl.includes('youtube.com/signin') ||
                         rawHtml.includes('input[type="password"]') ||
                         rawHtml.includes('Sign up to see photos') ||
                         rawHtml.includes('Please log in') ||
                         rawHtml.includes('Verify your identity') ||
                         (rawHtml.includes('sign in') && rawHtml.includes('password'));

      if (isAuthWall) {
        throw new AuthWallError(`Auth Wall detected at ${currentUrl}`);
      }
      
      // 2. Accurate Detection: Add "Checking your browser" and "Access Denied"
      const isChallenge = rawHtml.includes('cf-browser-verification') || 
                          rawHtml.includes('captcha') || 
                          rawHtml.includes('datadome') || 
                          rawHtml.includes('Verify you are human') || 
                          rawHtml.includes('Access Denied') || 
                          rawHtml.includes('Access to this page has been denied') || 
                          rawHtml.includes('Checking if the site connection is secure') || 
                          rawHtml.includes('Just a moment...') || 
                          rawHtml.includes('Checking your browser') || 
                          (url.includes('ycombinator') && rawHtml.includes('Sorry.'));

      if (isChallenge) {
        // 3. Throwing Logic: If isChallenge is detected, throw BotChallengeError immediately
        throw new BotChallengeError(`Bot Challenge detected in Playwright at ${currentUrl}`);
      }
    }
    
    const metadata = MetadataExtractor.extract(rawHtml);
    result.title = metadata.title;
    result.description = metadata.description;
    result.language = metadata.language;
    result.links = metadata.links;
    result.images = metadata.images;
    result.metadata = metadata.all_metadata;

    if (formats.includes('html')) {
      result.html = rawHtml;
    }

    const cleanedRawHtml = DOMCleaner.cleanContent(rawHtml);
    const cleanedArticle = ReadabilityExtractor.extract(cleanedRawHtml, url);
    
    if (cleanedArticle) {
      if (formats.includes('cleaned_html')) result.cleaned_html = cleanedArticle.content;
      if (formats.includes('text')) result.text = cleanedArticle.textContent;

      let markdownForChunking = '';
      if (formats.includes('markdown') || formats.includes('chunks')) {
        const markdownFormatter = new MarkdownFormatter();
        markdownForChunking = markdownFormatter.format(cleanedArticle.content);
        if (formats.includes('markdown')) result.markdown = markdownForChunking;
      }
      if (formats.includes('chunks') && markdownForChunking) {
        const chunker = new SemanticChunker();
        result.chunked_content = chunker.chunkText(markdownForChunking, { url, title: result.title });
      }
    }

    if (formats.includes('screenshot') && usedPlaywright) {
      const screenshotBuffer = await page.screenshot({ fullPage: true });
      result.screenshot = screenshotBuffer.toString('base64');
    }

    return result;
  }
}
