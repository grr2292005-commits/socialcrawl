import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { chromium } from 'playwright-extra';
import { Page, BrowserContext } from 'playwright';
// @ts-ignore
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { AdapterFactory } from '../adapters/AdapterFactory';
import { PlatformDetector } from '../adapters/PlatformDetector';

chromium.use(stealthPlugin());

const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
const scrapeQueue = new Queue('scrape-jobs', { connection: redis });

let browser: any;

const initBrowser = async () => {
  browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
};

const runScraper = async (job: Job) => {
  const { platform, url, options = {} } = job.data;

  console.log(`[WORKER] Processing URL: ${url}`);
  
  const detectedPlatform = (platform && platform !== 'auto' && platform !== 'default') ? platform : PlatformDetector.detect(url);
  job.log(`Starting scrape for ${detectedPlatform} at ${url}`);

  let contextOptions: any = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  };

  const context: BrowserContext = await browser.newContext(contextOptions);
  const page: Page = await context.newPage();
  
  try {
    if (options.isCrawl) {
      const results: any[] = [];
      const visited = new Set<string>();
      const queue = [{ url, depth: 0 }];
      const maxPages = options.maxPages || 5;
      const maxDepth = options.maxDepth || 1;

      while (queue.length > 0 && results.length < maxPages) {
        const current = queue.shift()!;
        if (visited.has(current.url)) continue;
        visited.add(current.url);

        job.log(`Spidering: ${current.url} (Depth: ${current.depth}/${maxDepth})`);
        
        try {
          const adapter = AdapterFactory.getAdapter(current.url, platform);
          const result = await adapter.extract(page, current.url, options);
          
          results.push({
            url: current.url,
            title: result.title,
            markdown: result.markdown,
            metadata: result.metadata
          });

          if (current.depth < maxDepth && result.internal_links) {
            for (const link of result.internal_links) {
              if (!visited.has(link)) {
                queue.push({ url: link, depth: current.depth + 1 });
              }
            }
          }
        } catch (e: any) {
          job.log(`Spider failed at ${current.url}: ${e.message}`);
        }
      }
      return results;
    }

    const adapter = AdapterFactory.getAdapter(url, platform);
    const result = await adapter.extract(page, url, { formats: ['markdown', 'text', 'metadata'], ...options });
    
    return {
      title: result.title,
      markdown: result.markdown,
      metadata: result.metadata,
      success: true
    };
    
  } catch (err: any) {
    throw err;
  } finally {
    await context.close().catch(() => {});
  }
};

const startWorker = async () => {
  await initBrowser();
  new Worker('scrape-jobs', async (job) => runScraper(job), { connection: redis, concurrency: 5 });
  console.log('Worker is running...');
};

startWorker().catch(console.error);
