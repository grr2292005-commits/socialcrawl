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
import { ProxyManager } from '../core/ProxyManager';

chromium.use(stealthPlugin());

const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@postgres:5432/socialcrawl' });
const warmingQueue = new Queue('session-warming', { connection: redis });
const scrapeQueue = new Queue('scrape-jobs', { connection: redis });
const proxyManager = ProxyManager.getInstance();

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
  const { platform, url, options = {} } = job.data;
  const detectedPlatform = (platform && platform !== 'auto' && platform !== 'default') ? platform : PlatformDetector.detect(url);
  job.log(`Starting scrape for ${detectedPlatform} at ${url}`);

  let contextOptions: any = {};

  // RULE 1: SEARCH ENGINE CLOAKING
  const isGooglebotTarget = ['linkedin', 'github', 'youtube', 'reddit'].includes(detectedPlatform);
  
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

  // RULE 3: PROXY MANAGER FOR PROTECTED PLATFORMS
  const needsResidential = ['producthunt', 'github', 'reddit'].includes(detectedPlatform);
  if (needsResidential && process.env.RESIDENTIAL_PROXY) {
    job.log(`Routing ${detectedPlatform} through residential proxy`);
    contextOptions.proxy = { server: process.env.RESIDENTIAL_PROXY };
  }

  const context: BrowserContext = await browser.newContext(contextOptions);
  const page: Page = await context.newPage();
  
  try {
    // Multi-Step Warmup for Protected Platforms
    if (detectedPlatform === 'producthunt') {
      await page.goto('https://www.producthunt.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);
    } else if (detectedPlatform === 'medium') {
      // PASSIVE WARMUP: Start at Google
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);
    } else if (['github', 'reddit'].includes(detectedPlatform)) {
      const home = detectedPlatform === 'github' ? 'https://github.com' : 'https://old.reddit.com';
      await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }

    if (detectedPlatform && detectedPlatform !== 'default') {
      try { await SessionInjector.injectSession(detectedPlatform, context, page); } catch (e) {}
    }

    const adapter = AdapterFactory.getAdapter(url, platform);
    const result = await adapter.extract(page, url, { formats: ['markdown', 'text', 'metadata'], ...options });
    
    // RECURSIVE QUEUEING: Handle Discovered Links
    if (options.isCrawl && options.currentDepth < options.maxDepth && result.internal_links) {
      const nextDepth = options.currentDepth + 1;
      const linksToQueue = result.internal_links.slice(0, options.maxPages);
      
      for (const link of linksToQueue) {
        await scrapeQueue.add('scrape-job', {
          platform,
          url: link,
          options: { ...options, currentDepth: nextDepth }
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 }
        });
      }
    }

    return result;
    
  } catch (err: any) {
    if (err.name === 'AuthWallError') {
      await pool.query('UPDATE platform_sessions SET is_valid = false WHERE platform = $1', [detectedPlatform]);
    }
    if (err.name === 'BotChallengeError') {
      options.forcePlaywright = true;
      await job.updateData({ ...job.data, options });
    }
    throw err;
  } finally {
    await context.close();
  }
};

const startWorker = async () => {
  await ensureDatabaseSchema(pool);
  await initBrowser();
  new Worker('scrape-jobs', async (job) => runScraper(job), { connection: redis, concurrency: 5 });
  console.log('Worker is running...');
};

startWorker().catch(console.error);
