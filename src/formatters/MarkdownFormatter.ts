import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm';

export class MarkdownFormatter {
  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      hr: '---'
    });

    this.turndown.use(gfm);

    // Strip empty links
    this.turndown.addRule('strip-empty-links', {
      filter: (node) => {
        return node.nodeName === 'A' && (!node.textContent || node.textContent.trim() === '');
      },
      replacement: () => ''
    });

    // Remove buttons/links that look like navigation even if missed by DOMCleaner
    this.turndown.addRule('strip-nav-like', {
      filter: (node) => {
        if (node.nodeName === 'A' || node.nodeName === 'BUTTON') {
          const text = node.textContent?.trim().toLowerCase() || '';
          return ['sign in', 'log in', 'sign up', 'get started', 'pricing', 'contact sales', 'developers', 'solutions', 'products'].includes(text) && node.parentNode?.nodeName === 'LI';
        }
        return false;
      },
      replacement: () => ''
    });
    // Remove redundant image alt text if it matches the filename or is too generic
    this.turndown.addRule('clean-image-alts', {
      filter: (node) => {
        if (node.nodeName === 'IMG') {
          const alt = node.getAttribute('alt')?.trim() || '';
          return alt.length < 3 || /^\d+$/.test(alt);
        }
        return false;
      },
      replacement: (content, node: any) => {
        const src = node.getAttribute('src');
        return src ? `![](${src})` : '';
      }
    });
  }

  public format(html: string): string {
    if (!html) return '';
    let markdown = this.turndown.turndown(html);
    
    // Squash excessive newlines
    markdown = markdown.replace(/\n{3,}/g, '\n\n');
    
    // Remove lines that are just navigation bullet points or separators
    markdown = markdown.split('\n').filter(line => {
      const clean = line.trim();
      if (clean === '*' || clean === '-' || clean === '•') return false;
      return true;
    }).join('\n');

    return markdown.trim();
  }
}
