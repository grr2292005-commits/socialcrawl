import { Page } from 'playwright';

export interface ExtractionResult {
  markdown?: string;
  html?: string;
  cleaned_html?: string;
  text?: string;
  metadata?: Record<string, any>;
  links?: string[];
  images?: string[];
  title?: string;
  description?: string;
  language?: string;
  url: string;
  platform: string;
  extracted_entities?: Record<string, any>[];
  chunked_content?: any[];
  screenshot?: string; // base64
  internal_links?: string[];
  success?: boolean;
}

export abstract class BaseAdapter {
  protected platform: string = 'unknown';

  abstract extract(page: Page, url: string, options: any): Promise<ExtractionResult>;
}
