import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { chromium } from 'playwright-extra';
import { Page, BrowserContext } from 'playwright';
// @ts-ignore
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { ensureDatabaseSchema } from './index';
import { ProxyManager } from '../core/ProxyManager';

chromium.use(stealthPlugin());

const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

const proxyManager = ProxyManager.getInstance();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@postgres:5432/socialcrawl',
});

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min: number, max: number) => delay(Math.floor(Math.random() * (max - min + 1) + min));

const warmSession = async (job: Job) => {
  const { platform, url } = job.data;
  console.log(`[Warming] Processing ${platform} at ${url}`);

  const proxy = proxyManager.getProxy();
  const browser = await chromium.launch({ 
    headless: true, 
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  const contextOptions: any = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: 'en-US'
  };

  // Googlebot Cloaking Pivot for warmer
  if (['linkedin', 'github', 'medium'].includes(platform)) {
    contextOptions.userAgent = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
    contextOptions.extraHTTPHeaders = { 
      'X-Forwarded-For': '66.249.66.1'
    };
  }

  if (proxy) {
    console.log(`[Warming] Using proxy: ${proxy.split('@').pop()}`);
    contextOptions.proxy = { server: proxy };
  }

  const context: BrowserContext = await browser.newContext(contextOptions);
  const page: Page = await context.newPage();

  try {
    job.log('Forging referrer via Google...');
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
    await delay(3000); 

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await job.updateProgress(30);

    for (let i = 0; i < 5; i++) {
      await randomDelay(100, 800);
      const x = Math.floor(Math.random() * 800);
      const y = Math.floor(Math.random() * 600);
      await page.mouse.move(x, y, { steps: 10 });
      const jitterScroll = Math.floor(Math.random() * 400) - 100; 
      await page.mouse.wheel(0, jitterScroll);
    }

    await job.updateProgress(70);

    const content = await page.content();
    if (content.includes('Security Check') || content.includes('Verify') || content.includes('Verify you are human')) {
      job.log(`[Block Detected] Warmer blocked for ${platform}.`);
      await pool.query('UPDATE platform_sessions SET is_valid = false, is_blocked = true WHERE platform = $1', [platform]);
      throw new Error(`Session warmer blocked by challenge on ${platform}`);
    }

    const cookies = await context.cookies();
    
    // Extraction of localStorage is permanently disabled to prevent ReferenceErrors
    const localStorage = {}; 

    const query = `
      INSERT INTO platform_sessions (id, platform, cookies, local_storage, is_valid, is_blocked, last_validated)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (id) DO UPDATE SET
        cookies = EXCLUDED.cookies,
        local_storage = EXCLUDED.local_storage,
        is_valid = EXCLUDED.is_valid,
        is_blocked = EXCLUDED.is_blocked,
        last_validated = NOW();
    `;
    
    const sessionId = job.data.sessionId || uuidv4();
    await pool.query(query, [sessionId, platform, JSON.stringify(cookies), JSON.stringify(localStorage), true, false]);

    job.log(`Session ${sessionId} warmed.`);
    await job.updateProgress(100);
    return { sessionId, platform };

  } catch (err: any) {
    job.log(`Session warming failed: ${err.message}`);
    throw err;
  } finally {
    await context.close();
    await browser.close();
  }
};

const startWarmer = async () => {
  await ensureDatabaseSchema(pool);
  new Worker('session-warming', async (job) => warmSession(job), { connection: redis, concurrency: 2 });
  console.log('Session Warmer running...');
};

startWarmer().catch(err => {
  console.error('Failed to start warmer:', err);
  process.exit(1);
});
