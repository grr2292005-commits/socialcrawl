import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { chromium } from 'playwright-extra';
// @ts-ignore
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { AdapterFactory } from '../adapters/AdapterFactory';
import { SessionInjector } from '../core/SessionInjector';
import { PlatformDetector } from '../adapters/PlatformDetector';
import { ExtractionValidationError } from '../errors/ExtractionValidationError';
import { AuthWallError } from '../errors/AuthWallError';
import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';

chromium.use(stealthPlugin());

const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@postgres:5432/socialcrawl',
});

const warmingQueue = new Queue('session-warming', { connection: redis });

/**
 * 1. Automatic Schema Initialization
 */
export const ensureDatabaseSchema = async (pool: Pool) => {
  const query = `
    CREATE TABLE IF NOT EXISTS platform_sessions (
      id TEXT PRIMARY KEY,
      platform TEXT,
      cookies JSONB,
      local_storage JSONB,
      is_valid BOOLEAN DEFAULT true,
      is_blocked BOOLEAN DEFAULT false,
      last_validated TIMESTAMP DEFAULT NOW()
    );
  `;
  try {
    await pool.query(query);
    console.log('[Database] Schema initialized successfully.');
  } catch (error) {
    console.error('[Database] Failed to initialize schema:', error);
  }
};

// 1. Persistent Browser Instance
let browser: any;

const initBrowser = async () => {
  console.log('Initializing persistent browser instance...');
  browser = await chromium.launch({
    headless: true,
  });
};

/**
 * 2. CDP Stealth Overrides
 */
export const applyAdvancedStealth = async (page: any) => {
  await page.addInitScript(() => {
    // Mask webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Override WebGL Renderer
    const getParameter = HTMLCanvasElement.prototype.getContext('2d')?.canvas.getContext('webgl')?.getParameter;
    if (getParameter) {
      // @ts-ignore
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        // UNMASKED_VENDOR_WEBGL
        if (parameter === 37445) return 'Intel Inc.';
        // UNMASKED_RENDERER_WEBGL
        if (parameter === 37446) return 'Intel(R) Iris(TM) Plus Graphics 640';
        return getParameter.apply(this, [parameter]);
      };
    }

    // Fake Plugins
    // @ts-ignore
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
  });
};

const runScraper = async (job: Job) => {
  const { platform, url, options = {} } = job.data;
  const stealthLevel = options.stealthLevel || 0;
  
  const detectedPlatform = (platform && platform !== 'auto' && platform !== 'default') ? platform : PlatformDetector.detect(url);
  job.log(`[Tier ${stealthLevel}] Starting scrape for ${detectedPlatform} at ${url}`);
  
  if (job.attemptsMade > 0) {
    const newProxy = `proxy-rotated-${uuidv4()}`;
    job.log(`Retry attempt ${job.attemptsMade}/3. Requesting new proxy IP.`);
    options.proxySessionId = newProxy;
    await job.updateData({ ...job.data, options });
  }

  // 1. Fingerprint Generator
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  ];

  const contextOptions: any = {
    userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
    viewport: { 
      width: Math.floor(Math.random() * (1920 - 1366) + 1366), 
      height: Math.floor(Math.random() * (1080 - 768) + 768) 
    },
    deviceScaleFactor: Math.random() > 0.5 ? 1 : 2,
    locale: 'en-US',
    hardwareConcurrency: Math.floor(Math.random() * 4) + 4
  };

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  
  // 3. Apply CDP Stealth
  await applyAdvancedStealth(page);
  
  try {
    if (detectedPlatform && detectedPlatform !== 'default') {
      try {
        const origin = new URL(url).origin;
        await page.goto(origin, { waitUntil: 'commit', timeout: 15000 });
        const injected = await SessionInjector.injectSession(detectedPlatform, context, page);
        if (injected) {
          job.log(`Successfully injected warm session for ${detectedPlatform}`);
        }
      } catch (sessionError) {
        job.log(`Session injection skipped: ${sessionError}`);
      }
    }

    await job.updateProgress(10);
    
    // 4. Navigation Guard
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});

    const adapter = AdapterFactory.getAdapter(url, platform);
    const extractionOptions = {
      formats: options.formats || ['markdown', 'text', 'metadata', 'chunks'],
      ...options
    };

    const result = await adapter.extract(page, url, extractionOptions);
    
    await job.updateProgress(90);
    return result;
    
  } catch (err: any) {
    if (err.name === 'AuthWallError') {
      job.log(`[Auth Wall] ${err.message}. Requesting re-warming.`);
      await pool.query('UPDATE platform_sessions SET is_valid = false WHERE platform = $1', [detectedPlatform]);
      const priority = detectedPlatform === 'linkedin' ? 1 : 10;
      await warmingQueue.add('warm-session', { 
        platform: detectedPlatform, 
        url: new URL(url).origin 
      }, { priority });
      throw err;
    }
    if (err.name === 'BotChallengeError') {
      job.log(`[Bot Challenge] Escalating stealth tier.`);
      options.stealthLevel = stealthLevel + 1;
      options.forcePlaywright = true;
      await job.updateData({ ...job.data, options });
      throw err;
    }
    throw err;
  } finally {
    await context.close();
  }
};

const startWorker = async () => {
  await ensureDatabaseSchema(pool);
  await initBrowser();

  const worker = new Worker('scrape-jobs', async (job) => {
    return runScraper(job);
  }, { 
    connection: redis,
    concurrency: 5
  });

  const publisher = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
  });

  worker.on('progress', (job, progress) => {
    if (job) {
      publisher.publish(`job_events:${job.id}`, JSON.stringify({ status: 'progress', progress }));
    }
  });

  worker.on('completed', async (job, result) => {
    console.log(`Job ${job.id} has completed!`);
    publisher.publish(`job_events:${job.id}`, JSON.stringify({ status: 'completed', data: result }));
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} has failed with ${err.message}`);
    if (job) {
      publisher.publish(`job_events:${job.id}`, JSON.stringify({ status: 'failed', error: err.message }));
    }
  });

  console.log('Worker is running...');
};

startWorker().catch(err => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
