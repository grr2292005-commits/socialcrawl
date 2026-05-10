import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm';

export class MarkdownFormatter {
  private turndownService: TurndownService;

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced'
    });

    // Use Github Flavored Markdown for tables, strikethrough, etc.
    this.turndownService.use(gfm);

    // Custom rules to preserve more structure for LLMs
    
    // Clean up links: preserve text if href is useless, otherwise format normally
    this.turndownService.addRule('preserveLinks', {
      filter: ['a'],
      replacement: (content, node) => {
        const element = node as HTMLAnchorElement;
        const href = element.getAttribute('href');
        const text = content.trim();
        
        if (!text) return ''; // Remove empty links
        if (!href || href.startsWith('javascript:') || href === '#') {
          return text;
        }
        return `[${text}](${href})`;
      }
    });

    // Preserve images with alt text, but drop tracking pixels
    this.turndownService.addRule('preserveImages', {
      filter: ['img'],
      replacement: (content, node) => {
        const element = node as HTMLImageElement;
        const src = element.getAttribute('src');
        const alt = element.getAttribute('alt') || '';
        
        if (!src || src.startsWith('data:') || src.includes('pixel') || src.includes('tracker')) {
          return ''; 
        }
        return `![${alt}](${src})`;
      }
    });
  }

  public format(html: string): string {
    if (!html) return '';
    try {
      let markdown = this.turndownService.turndown(html);
      
      // LLM Optimization: Remove excessive newlines
      markdown = markdown.replace(/\n{3,}/g, '\n\n');
      // LLM Optimization: Remove trailing spaces
      markdown = markdown.replace(/ \n/g, '\n');
      
      return markdown.trim();
    } catch (e) {
      console.error('Failed to format markdown', e);
      return '';
    }
  }
}
