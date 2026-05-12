import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { chromium } from 'playwright-extra';
import { Page, BrowserContext } from 'playwright';
// @ts-ignore
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { AdapterFactory } from '../adapters/AdapterFactory';
import { SessionInjector } from '../core/SessionInjector';
import { PlatformDetector } from '../adapters/PlatformDetector';
import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';

chromium.use(stealthPlugin());

const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@postgres:5432/socialcrawl' });
const scrapeQueue = new Queue('scrape-jobs', { connection: redis });

export const ensureDatabaseSchema = async (pool: Pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_sessions (
      id TEXT PRIMARY KEY, platform TEXT, cookies JSONB, local_storage JSONB,
      is_valid BOOLEAN DEFAULT true, is_blocked BOOLEAN DEFAULT false, last_validated TIMESTAMP DEFAULT NOW()
    );
  `).catch(console.error);
};

let browser: any;

const initBrowser = async () => {
  browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
};

const runScraper = async (job: Job) => {
  const { platform, url, options = {}, cookies } = job.data;

  console.log(`[WORKER] Processing URL: ${url}`);
  
  const detectedPlatform = (platform && platform !== 'auto' && platform !== 'default') ? platform : PlatformDetector.detect(url);
  job.log(`Starting scrape for ${detectedPlatform} at ${url} (Version: v3.0-FIRECRAWL-KILLER)`);

  let contextOptions: any = {};
  // ... (keep the contextOptions logic the same as before)
  const isGooglebotTarget = ['linkedin', 'github', 'youtube', 'reddit'].includes(detectedPlatform) || options.googlebot === true;
  
  if (isGooglebotTarget) {
    contextOptions = {
      userAgent: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.6943.53 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      extraHTTPHeaders: { 
        'X-Forwarded-For': '66.249.66.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
        'X-Google-GFE': '1',
        'X-Google-Crawler': '1'
      },
      viewport: { width: 412, height: 732 },
      isMobile: true,
      hasTouch: true
    };
  } else if (detectedPlatform === 'medium' || detectedPlatform === 'instagram') {
    contextOptions = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1
    };
  } else {
    contextOptions = {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true
    };
  }

  const needsResidential = ['producthunt', 'github', 'reddit'].includes(detectedPlatform);
  if (needsResidential && process.env.RESIDENTIAL_PROXY) {
    job.log(`Routing ${detectedPlatform} through residential proxy`);
    contextOptions.proxy = { server: process.env.RESIDENTIAL_PROXY };
  }

  const context: BrowserContext = await browser.newContext(contextOptions);
  if (cookies && Array.isArray(cookies)) {
    await context.addCookies(cookies);
  }
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

        job.log(`Spidering: ${current.url} (Depth: ${current.depth}/${maxDepth}, Progress: ${results.length + 1}/${maxPages})`);
        
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

    // Standard single-page scrape logic
    if (detectedPlatform && detectedPlatform !== 'default') {
      try { await SessionInjector.injectSession(detectedPlatform, context, page); } catch (e) {}
    }

    const adapter = AdapterFactory.getAdapter(url, platform);
    console.log(`[WORKER] Selected Adapter: ${adapter.constructor.name} for platform: ${detectedPlatform}`);
    console.log(`[WORKER] Cookies provided: ${cookies ? cookies.length : 0}`);

    const result = await adapter.extract(page, url, { formats: ['markdown', 'text', 'metadata'], ...options });
    
    const finalResult: any = {
      title: result.title,
      markdown: result.markdown,
      metadata: result.metadata,
      success: true
    };
    if (result.chunks) {
      finalResult.chunks = result.chunks;
    }
    return finalResult;
    
  } catch (err: any) {
    throw err;
  } finally {
    await context.close().catch(() => {});
  }
};

const startWorker = async () => {
  await ensureDatabaseSchema(pool);
  await initBrowser();
  new Worker('scrape-jobs', async (job) => runScraper(job), { connection: redis, concurrency: 5 });
  console.log('Worker is running...');
};

startWorker().catch(console.error);