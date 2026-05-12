import { BaseAdapter, ExtractionResult } from './BaseAdapter';
import { Page } from 'playwright';
import { ReadabilityExtractor } from '../extractors/ReadabilityExtractor';
import { MetadataExtractor } from '../extractors/MetadataExtractor';
import { MarkdownFormatter } from '../formatters/MarkdownFormatter';
import { DOMCleaner } from '../extractors/DOMCleaner';
import * as cheerio from 'cheerio';

export class LinkedInAdapter extends BaseAdapter {
  protected platform = 'linkedin';

  public async extract(page: Page, url: string, options: any): Promise<ExtractionResult> {
    console.log(`[LinkedInAdapter] Starting extraction for ${url}`);
    try {
      // 1. Navigate and Wait
      console.log(`[LinkedInAdapter] Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.waitForSelector('main', { timeout: 15000 }).catch(() => {});
      await page.waitForSelector('h1', { timeout: 10000 }).catch(() => {});
      console.log(`[LinkedInAdapter] Current URL after navigation: ${page.url()}`);
      
      // Scroll to trigger lazy loading
      console.log(`[LinkedInAdapter] Scrolling...`);
      await page.evaluate(async () => {
        for (let i = 0; i < 12; i++) {
          window.scrollBy(0, 800);
          await new Promise(r => setTimeout(r, 500));
        }
      });
      
      await page.waitForTimeout(4000); 

      // 1.5. Auth Check
      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/authwall') || currentUrl.includes('/signup')) {
        console.warn(`[LinkedInAdapter] AuthWall detected: ${currentUrl}`);
        return {
          url,
          platform: 'linkedin',
          success: false,
          error: "AuthRequired",
          message: "LinkedIn requires authentication. Current URL: " + currentUrl
        };
      }

      // 2. Auto-Expansion
      console.log(`[LinkedInAdapter] Expanding sections...`);
      const expandSelectors = [
        '.inline-show-more-text__button',
        '#navigation-index-see-all-experiences',
        '.pv-profile-section__see-more-button',
        'button.pv-about-section__expand-button',
        'button[aria-label*="see more"]'
      ];

      for (const selector of expandSelectors) {
        try {
          const buttons = await page.$$(selector);
          console.log(`[LinkedInAdapter] Found ${buttons.length} buttons for selector ${selector}`);
          for (const button of buttons) {
            if (await button.isVisible()) {
              await button.click({ timeout: 2000 }).catch(() => {});
              await page.waitForTimeout(500);
            }
          }
        } catch (e) {}
      }

      // 3. Extraction logic (Hybrid Waterfall)
      console.log(`[LinkedInAdapter] Running hybrid extraction...`);
      const rawHtml = await page.content();
      console.log(`[LinkedInAdapter] HTML length: ${rawHtml.length}`);
      
      // Diagnostic Screenshot
      await page.screenshot({ path: 'testing/last-scrape.png', fullPage: true }).catch(() => {});
      
      const metadata = MetadataExtractor.extract(rawHtml);
      const $ = cheerio.load(rawHtml);
      
      const name = $('h1').first().text().trim() || 
                   $('.text-heading-xlarge').first().text().trim() || 
                   $('.top-card-layout__title').first().text().trim() || 
                   metadata.title?.split('|')[0].trim() || 'LinkedIn Profile';

      const headline = $('.text-body-medium.break-words').first().text().trim() || 
                       $('.top-card-layout__headline').text().trim() || 
                       metadata.all_metadata?.['og:description'] || '';

      console.log("[LinkedInAdapter] Headline Found: ", headline);

      let markdown = `# ${name}\n`;
      if (headline) markdown += `**Headline:** ${headline}\n\n`;

      const cleanedHtml = DOMCleaner.cleanContent(rawHtml, url);
      const article = ReadabilityExtractor.extract(cleanedHtml, url);

      if (article && article.textContent.length > 500) {
        console.log(`[LinkedInAdapter] Using Readability extraction (Text length: ${article.textContent.length})`);
        markdown += new MarkdownFormatter().format(article.content);
      } else {
        console.log(`[LinkedInAdapter] Falling back to manual scaffold`);
        
        // Manual Scaffold: About
        let about = $('div#about').nextAll('div').text().trim() || 
                    $('.pv-about-section').text().trim() ||
                    $('section').filter((i, el) => $(el).text().includes('About')).find('.inline-show-more-text').first().text().trim();
        
        if (about) {
          markdown += `## About\n${about.replace(/\n+/g, '\n\n')}\n\n`;
        }

        // Manual Scaffold: Experience
        const experiences: string[] = [];
        const experienceSection = $('div#experience').closest('section') || $('section').filter((i, el) => $(el).text().includes('Experience')).first();
        const experienceItems = experienceSection.find('li');
        
        experienceItems.each((_, el) => {
          const text = $(el).text().replace(/\s+/g, ' ').trim();
          if (text.length > 20) experiences.push(`- ${text}`);
        });

        if (experiences.length > 0) {
          markdown += `## Experience\n${experiences.join('\n\n')}\n`;
        }
      }

      const constructedMarkdown = markdown.trim();
      console.log(`[LinkedInAdapter] Extraction complete. Markdown length: ${constructedMarkdown.length}`);
      
      return {
        url,
        platform: 'linkedin',
        success: true,
        title: name,
        markdown: constructedMarkdown,
        debug: { 
          htmlLength: rawHtml.length,
          readabilitySuccess: !!(article && article.textContent.length > 500)
        }
      };

    } catch (err: any) {
      console.error(`[LinkedInAdapter] Extraction failed for ${url}:`, err.message);
      return {
        url,
        platform: 'linkedin',
        success: false,
        error: "ExtractionError",
        message: err.message
      };
    }
  }
}
