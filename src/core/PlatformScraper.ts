export interface ScrapeJobOptions {
  maxDepth?: number;
  limit?: number;
  waitForSelectors?: string[];
  formats?: ('markdown' | 'json' | 'embeddings')[];
  proxySessionId?: string;
}

export interface ExtractResult {
  platform: string;
  metadata: Record<string, any>;
  markdown: string;
  json_data: any[];
  embeddings_ready_chunks?: { text: string; metadata: any }[];
}

export interface PlatformScraper {
  /**
   * Optional: Handle platform authentication and store session cookies.
   */
  authenticate?(): Promise<void>;
  
  /**
   * Scrape a specific entity profile.
   */
  scrapeProfile(url: string, options: ScrapeJobOptions): Promise<ExtractResult>;
  
  /**
   * Scrape a specific post/thread.
   */
  scrapePost(url: string, options: ScrapeJobOptions): Promise<ExtractResult>;
  
  /**
   * Scrape search results.
   */
  scrapeSearch(query: string, options: ScrapeJobOptions): Promise<ExtractResult>;
  
  /**
   * Normalize the raw extracted data into standard schema.
   */
  normalize(rawData: any): ExtractResult;
}
