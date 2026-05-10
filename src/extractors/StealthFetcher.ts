export interface StealthFetchResult {
  html: string;
  statusCode: number;
}

export class StealthFetcher {
  /**
   * Attempts to fetch the target URL using a Node.js based HTTP client that mimics
   * browser TLS signatures (JA3/JA4) to bypass basic anti-bot fingerprinting.
   * 
   * @param url The target URL to scrape
   * @param proxyUrl Optional proxy URL
   * @returns The raw HTML and the HTTP status code
   */
  public static async fetch(url: string, proxyUrl?: string): Promise<StealthFetchResult> {
    try {
      // Dynamically import got-scraping since it is an ESM-only package
      // and this project is configured as CommonJS.
      const { gotScraping } = await import('got-scraping');

      const response = await gotScraping({
        url,
        proxyUrl: proxyUrl,
        responseType: 'text',
        retry: { limit: 0 },
        timeout: { request: 15000 },
        headerGeneratorOptions: {
          browsers: [{ name: 'chrome', minVersion: 110 }],
          devices: ['desktop'],
          locales: ['en-US', 'en'],
          operatingSystems: ['windows', 'macos']
        }
      });
      
      return {
        html: response.body,
        statusCode: response.statusCode
      };
    } catch (error: any) {
      return {
        html: error.response?.body || '',
        statusCode: error.response?.statusCode || 500
      };
    }
  }
}
