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
                          fetchResult.html.includes('datadome');

      // Deterministic Content Density Check
      let isSparseSPA = false;
      if (fetchResult.statusCode === 200 && !isChallenge) {
        const $ = cheerio.load(fetchResult.html);
        $('script, style, svg').remove();
        const textContentLength = $('body').text().replace(/\s+/g, ' ').trim().length;
        const hasSPAMounts = fetchResult.html.includes('id="root"') || 
                             fetchResult.html.includes('id="__next"') || 
                             fetchResult.html.includes('id="app"') || 
                             fetchResult.html.includes('<yt-root>') ||
                             fetchResult.html.includes('<app-root>');

        if (textContentLength < 500 || hasSPAMounts) {
          console.log(`[Adapter] Stealth fetch returned sparse SPA shell (Text length: ${textContentLength}).`);
          isSparseSPA = true;
        }
      }

      if (fetchResult.statusCode === 200 && !isChallenge && !isSparseSPA) {
        console.log(`[Adapter] Stealth fetch succeeded for ${url}. Skipping Playwright.`);
        rawHtml = fetchResult.html;
      }
    }

    if (!rawHtml) {
      console.log(`[Adapter] Stealth fetch skipped or failed. Falling back to Playwright.`);
      usedPlaywright = true;
      
      // 1. Speed Optimization: Ensure we use domcontentloaded for faster initial render
      if (page.url() === 'about:blank' || page.url() !== url) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // 3. Deterministic hydration window instead of waiting for endless background trackers
        await page.waitForTimeout(2000);
      }

      // --- Post-Injection Session Validation ---
      const currentUrl = page.url();
      const content = await page.content();
      
      const isAuthWall = currentUrl.includes('/login') || 
                         currentUrl.includes('/authwall') || 
                         currentUrl.includes('/signup') ||
                         content.includes('input[type="password"]') ||
                         content.includes('sign in') && content.includes('password');

      if (isAuthWall) {
        console.log(`[Adapter] Auth Wall detected at ${currentUrl}. Flagging session as invalid.`);
        throw new AuthWallError(`Auth Wall detected at ${currentUrl}`);
      }
      
      rawHtml = content;
    }
    
    // 1. Metadata Extraction
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

    // 2. Advanced Boilerplate Removal & DOM Cleaning
    const cleanedRawHtml = DOMCleaner.cleanContent(rawHtml);

    // 3. Mozilla Readability Processing
    const cleanedArticle = ReadabilityExtractor.extract(cleanedRawHtml, url);
    
    if (cleanedArticle) {
      if (formats.includes('cleaned_html')) {
        result.cleaned_html = cleanedArticle.content;
      }
      
      if (formats.includes('text')) {
        result.text = cleanedArticle.textContent;
      }

      let markdownForChunking = '';
      if (formats.includes('markdown') || formats.includes('chunks')) {
        const markdownFormatter = new MarkdownFormatter();
        markdownForChunking = markdownFormatter.format(cleanedArticle.content);
        if (formats.includes('markdown')) {
          result.markdown = markdownForChunking;
        }
      }

      if (formats.includes('chunks') && markdownForChunking) {
        const chunker = new SemanticChunker();
        result.chunked_content = chunker.chunkText(markdownForChunking, {
          url,
          title: result.title
        });
      }
    } else {
      // Fallback if readability fails
      let fallbackMarkdown = '';
      if (formats.includes('markdown') || formats.includes('chunks')) {
        const markdownFormatter = new MarkdownFormatter();
        fallbackMarkdown = markdownFormatter.format(cleanedRawHtml);
        if (formats.includes('markdown')) {
          result.markdown = fallbackMarkdown;
        }
      }
      
      if (formats.includes('chunks') && fallbackMarkdown) {
        const chunker = new SemanticChunker();
        result.chunked_content = chunker.chunkText(fallbackMarkdown, {
          url,
          title: result.title
        });
      }
    }

    // 4. Screenshots (Only available if Playwright was actually used)
    if (formats.includes('screenshot') && usedPlaywright) {
      const screenshotBuffer = await page.screenshot({ fullPage: true });
      result.screenshot = screenshotBuffer.toString('base64');
    }

    return result;
  }
}
