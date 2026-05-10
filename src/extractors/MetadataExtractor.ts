import * as cheerio from 'cheerio';

export class MetadataExtractor {
  public static extract(html: string): Record<string, any> {
    const $ = cheerio.load(html);
    const metadata: Record<string, any> = {};

    // Standard meta tags
    $('meta').each((_, el) => {
      const name = $(el).attr('name') || $(el).attr('property');
      const content = $(el).attr('content');
      
      if (name && content) {
        metadata[name] = content;
      }
    });

    // Links
    const links: string[] = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('javascript:')) {
        links.push(href);
      }
    });

    // Images
    const images: string[] = [];
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src && !src.startsWith('data:')) {
        images.push(src);
      }
    });

    return {
      title: $('title').text() || metadata['og:title'] || metadata['twitter:title'],
      description: metadata['description'] || metadata['og:description'] || metadata['twitter:description'],
      author: metadata['author'] || metadata['article:author'],
      published_time: metadata['article:published_time'],
      canonical_url: $('link[rel="canonical"]').attr('href') || metadata['og:url'],
      language: $('html').attr('lang') || metadata['og:locale'],
      all_metadata: metadata,
      links: Array.from(new Set(links)), // Deduplicate
      images: Array.from(new Set(images))
    };
  }
}
