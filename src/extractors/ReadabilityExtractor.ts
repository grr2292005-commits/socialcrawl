import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export interface CleanedArticle {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string;
  dir: string;
  siteName: string;
  lang: string;
}

export class ReadabilityExtractor {
  public static extract(html: string, url: string): CleanedArticle | null {
    try {
      const doc = new JSDOM(html, { url });
      const reader = new Readability(doc.window.document);
      const article = reader.parse();
      
      if (!article) return null;

      return {
        title: article.title || '',
        content: article.content || '',
        textContent: article.textContent || '',
        length: article.length || 0,
        excerpt: article.excerpt || '',
        byline: article.byline || '',
        dir: article.dir || '',
        siteName: article.siteName || '',
        lang: article.lang || ''
      };
    } catch (e) {
      console.error('Readability extraction failed:', e);
      return null;
    }
  }
}
