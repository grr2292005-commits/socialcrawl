import { BaseAdapter, ExtractionResult } from './BaseAdapter';
import { Page } from 'playwright';
import { ReadabilityExtractor } from '../extractors/ReadabilityExtractor';
import { MetadataExtractor } from '../extractors/MetadataExtractor';
import { MarkdownFormatter } from '../formatters/MarkdownFormatter';
import { SemanticChunker } from '../chunkers/SemanticChunker';
import { DOMCleaner } from '../extractors/DOMCleaner';
import { StealthFetcher } from '../extractors/StealthFetcher';

export class DefaultAdapter extends BaseAdapter {
  protected platform = 'default';

  public async extract(page: Page, url: string, options: any): Promise<ExtractionResult> {
    const formats = options.formats || ['markdown', 'json'];

    let result: ExtractionResult = { url, platform: this.platform };
    let rawHtml = '';
    let usedPlaywright = false;

    // 0. Attempt Stealth Fetch First
    console.log(`[Adapter] Attempting stealth fetch for ${url}`);
    const fetchResult = await StealthFetcher.fetch(url, options.proxySessionId);

    const isChallenge = fetchResult.statusCode === 403 || 
                        fetchResult.statusCode === 503 || 
                        fetchResult.html.includes('cf-browser-verification') || 
                        fetchResult.html.includes('captcha') ||
                        fetchResult.html.includes('datadome');

    if (fetchResult.statusCode === 200 && !isChallenge && fetchResult.html.length > 500) {
      console.log(`[Adapter] Stealth fetch succeeded for ${url}. Skipping Playwright.`);
      rawHtml = fetchResult.html;
    } else {
      console.log(`[Adapter] Stealth fetch failed or challenged (Status: ${fetchResult.statusCode}). Falling back to Playwright.`);
      usedPlaywright = true;
      
      // Execute Playwright navigation if not already on the target URL
      if (page.url() === 'about:blank' || page.url() !== url) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch(e) {}
      }
      
      rawHtml = await page.content();
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
