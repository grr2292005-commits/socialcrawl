import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { chromium } from 'playwright-extra';
// @ts-ignore
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { ensureDatabaseSchema } from './index';

chromium.use(stealthPlugin());

const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@postgres:5432/socialcrawl',
});

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min: number, max: number) => delay(Math.floor(Math.random() * (max - min + 1) + min));

const warmSession = async (job: Job) => {
  const { platform, url } = job.data;
  job.log(`Warming session for ${platform} at ${url}`);

  const browser = await chromium.launch({ headless: true });
  
  // Hardware Masking for Warmer
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { 
      width: Math.floor(Math.random() * (1920 - 1280) + 1280), 
      height: Math.floor(Math.random() * (1080 - 720) + 720) 
    },
    locale: ['en-US', 'en-GB'][Math.floor(Math.random() * 2)],
    deviceScaleFactor: 1,
    hardwareConcurrency: Math.floor(Math.random() * (8 - 4) + 4)
  });
  
  // Extra Stealth: Mask webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await job.updateProgress(30);

    // Randomized Human-Like Behavior
    for (let i = 0; i < 5; i++) {
      await randomDelay(500, 1500);
      
      // Randomized Mouse Movements
      const x = Math.floor(Math.random() * 800);
      const y = Math.floor(Math.random() * 600);
      await page.mouse.move(x, y, { steps: 10 });

      // "Human Jitter" scrolling
      const jitterScroll = Math.floor(Math.random() * 300) - 50; 
      await page.mouse.wheel(0, jitterScroll);
      job.log(`Human Jitter: moved mouse to (${x},${y}), scrolled ${jitterScroll}px`);
    }

    await job.updateProgress(70);

    // --- Post-Login / Post-Navigation Challenge Check ---
    const content = await page.content();
    if (content.includes('Security Check') || content.includes('Verify') || content.includes('Verify you are human')) {
      job.log(`[Block Detected] Session warmer hit a challenge for ${platform}. Rotating proxy and marking as blocked.`);
      
      // Mark session as blocked in DB
      await pool.query('UPDATE platform_sessions SET is_valid = false, is_blocked = true WHERE platform = $1', [platform]);
      
      // Simulated Proxy Rotation Log
      job.log(`[Proxy Rotation] Requesting new IP for ${platform} warmer node.`);
      throw new Error(`Session warmer blocked by challenge on ${platform}`);
    }

    const cookies = await context.cookies();
    const localStorage = await page.evaluate(() => {
      const ls: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) {
          ls[key] = window.localStorage.getItem(key) || '';
        }
      }
      return ls;
    });

    const query = `
      INSERT INTO platform_sessions (id, platform, cookies, local_storage, is_valid, last_validated)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (id) DO UPDATE SET
        cookies = EXCLUDED.cookies,
        local_storage = EXCLUDED.local_storage,
        is_valid = EXCLUDED.is_valid,
        last_validated = NOW();
    `;
    
    const sessionId = job.data.sessionId || uuidv4();
    
    await pool.query(query, [
      sessionId,
      platform,
      JSON.stringify(cookies),
      JSON.stringify(localStorage),
      true
    ]);

    job.log(`Session ${sessionId} successfully warmed and saved.`);
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
  // Ensure schema exists
  await ensureDatabaseSchema(pool);

  const worker = new Worker('session-warming', async (job) => {
    return warmSession(job);
  }, {
    connection: redis,
    concurrency: 2,
  });

  worker.on('completed', (job) => {
    console.log(`Session warming job ${job.id} completed!`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Session warming job ${job?.id} failed with ${err.message}`);
  });

  console.log('Session Warmer is running and listening to session-warming queue...');
};

startWarmer().catch(err => {
  console.error('Failed to start warmer:', err);
  process.exit(1);
});
