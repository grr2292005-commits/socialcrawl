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
const warmingQueue = new Queue('session-warming', { connection: redis });

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

  const contextOptions: any = detectedPlatform === 'instagram' ? {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1
  } : {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document'
    }
  };

  const context: BrowserContext = await browser.newContext(contextOptions);
  const page: Page = await context.newPage();
  
  try {
    // Multi-Step Warmup for ProductHunt
    if (detectedPlatform === 'producthunt') {
      job.log(`Warming up for ProductHunt...`);
      await page.goto('https://www.producthunt.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      await page.mouse.move(100, 100);
      await page.waitForTimeout(2000);
    }

    // Session Injection Attempt
    if (detectedPlatform && detectedPlatform !== 'default') {
      try { 
        job.log(`Attempting session injection for ${detectedPlatform}...`);
        const injected = await SessionInjector.injectSession(detectedPlatform, context, page); 
        if (injected) job.log(`Successfully injected session for ${detectedPlatform}`);
      } catch (e) {
        job.log(`Session injection failed or not found for ${detectedPlatform}`);
      }
    }

    const adapter = AdapterFactory.getAdapter(url, platform);
    const result = await adapter.extract(page, url, { formats: ['markdown', 'text', 'metadata'], ...options });
    return result;
    
  } catch (err: any) {
    if (err.name === 'AuthWallError') {
      await pool.query('UPDATE platform_sessions SET is_valid = false WHERE platform = $1', [detectedPlatform]);
      await warmingQueue.add('warm-session', { platform: detectedPlatform, url: new URL(url).origin }, { priority: 1 });
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
