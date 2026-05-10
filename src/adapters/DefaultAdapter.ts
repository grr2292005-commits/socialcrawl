import { BaseAdapter, ExtractionResult } from './BaseAdapter';
import { Page } from 'playwright';
import { ReadabilityExtractor } from '../extractors/ReadabilityExtractor';
import { MetadataExtractor } from '../extractors/MetadataExtractor';
import { MarkdownFormatter } from '../formatters/MarkdownFormatter';
import { SemanticChunker } from '../chunkers/SemanticChunker';
import { DOMCleaner } from '../extractors/DOMCleaner';

export class DefaultAdapter extends BaseAdapter {
  protected platform = 'default';

  public async extract(page: Page, url: string, options: any): Promise<ExtractionResult> {
    const rawHtml = await page.content();
    const formats = options.formats || ['markdown', 'json'];

    let result: ExtractionResult = { url, platform: this.platform };
    
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

    // 4. Screenshots
    if (formats.includes('screenshot')) {
      const screenshotBuffer = await page.screenshot({ fullPage: true });
      result.screenshot = screenshotBuffer.toString('base64');
    }

    return result;
  }
}
