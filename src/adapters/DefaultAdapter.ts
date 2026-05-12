import { BaseAdapter, ExtractionResult } from './BaseAdapter';
import { Page } from 'playwright';
import { ReadabilityExtractor } from '../extractors/ReadabilityExtractor';
import { MetadataExtractor } from '../extractors/MetadataExtractor';
import { MarkdownFormatter } from '../formatters/MarkdownFormatter';
import { DOMCleaner } from '../extractors/DOMCleaner';
import { SemanticChunker } from '../chunkers/SemanticChunker';
import * as cheerio from 'cheerio';

export class DefaultAdapter extends BaseAdapter {
  protected platform = 'default';

  public async extract(page: Page, url: string, options: any): Promise<ExtractionResult> {
    page.on('pageerror', (err) => { /* ignore hostile DOM errors */ });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      try {
        await page.mouse.wheel(0, 1000);
        await page.waitForTimeout(500);
        await page.mouse.wheel(0, 1000);
        await page.waitForTimeout(1000);
      } catch (e) {}

      const rawHtml = await page.content();
      
      const metadata = MetadataExtractor.extract(rawHtml);
      const title = metadata.title || await page.title().catch(() => 'Untitled');

      const cleanedHtml = DOMCleaner.cleanContent(rawHtml, url);
      
      // TIER 1 (Article Mode)
      const article = ReadabilityExtractor.extract(cleanedHtml, url);
      
      let contentHtml = '';
      if (article && article.textContent.length > 200) {
        contentHtml = article.content;
      } else {
        // TIER 2 (Landing Page Fallback)
        const $ = cheerio.load(cleanedHtml);
        contentHtml = $('main').html() || $('#root').html() || $('body').html() || '';
      }

      const markdown = new MarkdownFormatter().format(contentHtml);
      
      const internalLinks = this.extractInternalLinks(rawHtml, url);
      
      const result: any = {
        url,
        platform: this.platform,
        title,
        markdown,
        metadata: metadata.all_metadata,
        internal_links: internalLinks,
        success: true
      };

      if (options.formats && options.formats.includes('chunked') && result.markdown) {
        const chunker = new SemanticChunker();
        result.chunks = chunker.chunkText(result.markdown, { url: result.url, title: result.title });
      }

      return result;

    } catch (err: any) {
      console.error(`[DefaultAdapter] Extraction failed for ${url}:`, err.message);
      return {
        url,
        platform: this.platform,
        success: false,
        error: "ProtectionWall",
        markdown: "# Protected Content\n\nThis site is protected or failed to load correctly. It may require a residential proxy or advanced session warming."
      };
    }
  }

  private extractInternalLinks(html: string, baseUrl: string): string[] {
    try {
      const $ = cheerio.load(html);
      const links = new Set<string>();
      const base = new URL(baseUrl);

      $('a[href]').each((_, el) => {
        try {
          const href = $(el).attr('href');
          if (!href) return;

          const absoluteUrl = new URL(href, baseUrl);
          if (absoluteUrl.hostname === base.hostname && 
              absoluteUrl.protocol.startsWith('http') &&
              !absoluteUrl.pathname.match(/\.(pdf|zip|jpg|png|mp4|exe)$/i)) {
            
            const cleanUrl = absoluteUrl.origin + absoluteUrl.pathname + absoluteUrl.search;
            if (cleanUrl !== baseUrl) links.add(cleanUrl);
          }
        } catch (e) {}
      });

      return Array.from(links).slice(0, 50);
    } catch (e) {
      return [];
    }
  }
}
