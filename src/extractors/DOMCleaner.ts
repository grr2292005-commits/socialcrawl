import * as cheerio from 'cheerio';

export class DOMCleaner {
  public static cleanContent(html: string, baseUrl: string): string {
    const $ = cheerio.load(html);

    // 1. Aggressive Strip (Never remove main, article, section, table)
    $('script, style, noscript, iframe, canvas, svg, path, symbol').remove();
    
    // 2. Remove Common Noise & Hidden
    $('[aria-hidden="true"]').remove();
    $('[style*="display: none"], [style*="visibility: hidden"], [hidden]').remove();

    const noiseSelectors = [
      'nav', 'footer', 'header', 'aside', 
      '.cookie-banner', '.gdpr', '#cookie-notice', 
      '[role="banner"]', '[role="navigation"]', 
      '.sidebar', '.social-share', '.newsletter-popup',
      '.ad-container', '.promo-bar', '.login-modal',
      '.nav-links', '.footer-links', '.navigation',
      '.pagination', '.carousel-controls', '.slick-arrow', '.slick-dots',
      '#nav', '#footer', '#header'
    ];
    
    // Only remove noise selectors if they aren't part of the core content structure
    $(noiseSelectors.join(', ')).not('main, article, section, table').remove();

    // 3. Absolute-ify URLs
    try {
      const base = new URL(baseUrl);
      
      $('a[href]').each((_, el) => {
        try {
          const href = $(el).attr('href');
          if (href && !href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('#')) {
            $(el).attr('href', new URL(href, base.origin + base.pathname).toString());
          }
        } catch (e) {}
      });

      $('img[src]').each((_, el) => {
        try {
          const src = $(el).attr('src');
          if (src && !src.startsWith('http') && !src.startsWith('data:')) {
            $(el).attr('src', new URL(src, base.origin + base.pathname).toString());
          }
        } catch (e) {}
      });
    } catch (e) {}

    return $.html();
  }
}
