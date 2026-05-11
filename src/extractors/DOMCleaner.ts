import * as cheerio from 'cheerio';
import { BotChallengeError } from '../errors/BotChallengeError';

export class DOMCleaner {
  // Common selectors for noise elements that offer no value to LLMs
  private static readonly NOISE_SELECTORS = [
    'nav', 'header', 'footer', 'aside',
    '.sidebar', '#sidebar', '.nav', '.menu', '.header', '.footer',
    '.ad', '.ads', '.advertisement', '.advert', '#ad',
    '#cookie-banner', '.cookie-banner', '.cookie-notice', '#gdpr', '.gdpr',
    '.login-prompt', '.paywall', '.subscription', '.newsletter',
    '.social-share', '.share-buttons', '.share',
    '.related-articles', '.recommendations', '.widget', '.promo',
    'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
    '[role="dialog"]', '[role="alert"]', '[role="banner"]', '[role="navigation"]', '[role="complementary"]'
  ];

  // Selectors that are strongly indicative of core content
  private static readonly IMPORTANT_SELECTORS = [
    'article', 'main', '[role="main"]',
    '.post-body', '.comment', '.thread',
    '.markdown-body', '.readme', '#readme',
    '.content', '.article'
  ];

  public static cleanContent(html: string): string {
    const $ = cheerio.load(html);

    const fullText = $('body').text() || '';
    // Challenge detection moved to Adapters for more granular control.
    
    // 1. Remove noise based on basic selector matching
    this.NOISE_SELECTORS.forEach(selector => {
      $(selector).remove();
    });

    // 2. Score and prune elements based on text density and semantic relevance
    $('div, section, ul, li').each((_, el) => {
      const element = $(el);
      const rawHtml = element.html() || '';
      const htmlLength = rawHtml.length;
      const text = element.text().trim();
      const textLength = text.length;
      
      // Calculate text density (text length / HTML markup length)
      const textDensity = htmlLength > 0 ? textLength / htmlLength : 0;
      
      // Calculate link density
      const linkTextLength = element.find('a').text().trim().length;
      const linkDensity = textLength > 0 ? linkTextLength / textLength : 0;

      // Semantic relevance scoring
      let score = 0;
      const classAndId = (element.attr('class') || '') + ' ' + (element.attr('id') || '');
      
      // DOM importance ranking
      this.IMPORTANT_SELECTORS.forEach(sel => {
        if (element.is(sel) || element.closest(sel).length > 0) {
          score += 50;
        }
      });

      // Penalize elements that look like boilerplate
      if (classAndId.match(/(comment|meta|footer|footnote)/i)) score -= 20;
      // Reward elements that look like core content
      if (classAndId.match(/(post|entry|content|text|body|article|main)/i)) score += 25;

      // If it is strongly ranked as important, preserve it
      if (score > 20) return;

      // Boilerplate removal logic
      // Rule A: Low text density and high link density usually means a list of related links or widgets
      if (textDensity < 0.1 && textLength < 100) {
        element.remove();
      } else if (linkDensity > 0.5 && textLength < 300 && score < 10) {
        element.remove();
      }
    });

    // 3. Remove empty tags to clean up the DOM tree
    $('div, p, section, article').each((_, el) => {
      const element = $(el);
      if (element.text().trim().length === 0 && element.find('img, iframe').length === 0) {
        element.remove();
      }
    });

    return $.html();
  }
}
