import { Worker, Job } from 'bullmq';
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
import { Queue } from 'bullmq';

chromium.use(stealthPlugin());

const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@postgres:5432/socialcrawl',
});

const warmingQueue = new Queue('session-warming', { connection: redis });

// Persistent browser instance
let browser: any;

const initBrowser = async () => {
  console.log('Initializing persistent browser instance...');
  browser = await chromium.launch({
    headless: true,
  });
};

// This simulates the plugin system
const runScraper = async (job: Job) => {
  const { platform, url, options = {} } = job.data;
  
  const detectedPlatform = (platform && platform !== 'auto' && platform !== 'default') ? platform : PlatformDetector.detect(url);
  job.log(`Starting scrape for ${detectedPlatform} at ${url}`);
  
  if (job.attemptsMade > 0) {
    const newProxy = `proxy-rotated-${uuidv4()}`;
    job.log(`Retry attempt ${job.attemptsMade}/3. Requesting new proxy IP (${newProxy}) from Proxy Manager to rule out location-based UI variations.`);
    options.proxySessionId = newProxy;
    await job.updateData({ ...job.data, options });
  }

  // Create isolated context from persistent browser
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  try {
    // 2. Inject Warm Session
    if (detectedPlatform && detectedPlatform !== 'default') {
      try {
        const origin = new URL(url).origin;
        // LocalStorage requires the page to be on the target origin first
        await page.goto(origin, { waitUntil: 'commit', timeout: 15000 });
        const injected = await SessionInjector.injectSession(detectedPlatform, context, page);
        if (injected) {
          job.log(`Successfully injected warm session for ${detectedPlatform}`);
        }
      } catch (sessionError) {
        job.log(`Session injection skipped or failed: ${sessionError}`);
      }
    }

    // 3. Execute Navigation
    await job.updateProgress(10);
    // Note: DefaultAdapter now handles navigation and AuthWall validation internally
    
    // 4. Transformation & Extraction using Adapter
    const adapter = AdapterFactory.getAdapter(url, platform);
    
    // Provide default formats if not specified
    const extractionOptions = {
      formats: options.formats || ['markdown', 'text', 'metadata', 'chunks'],
      ...options
    };

    const result = await adapter.extract(page, url, extractionOptions);
    
    await job.updateProgress(90);
    return result;
    
  } catch (err: any) {
    if (err.name === 'AuthWallError') {
      job.log(`[Auth Wall] ${err.message}. Invalidating session and requesting re-warming.`);
      
      // Invalidate session in DB
      await pool.query('UPDATE platform_sessions SET is_valid = false WHERE platform = $1', [detectedPlatform]);
      
      // Trigger new warming job
      await warmingQueue.add('warm-session', { 
        platform: detectedPlatform, 
        url: new URL(url).origin 
      });
      
      // Removed manual moveToDelayed to prevent lock corruption.
      // BullMQ native retry logic with backoff will handle the delay safely.
      throw err;
    }
    if (err.name === 'BotChallengeError') {
      job.log(`[Bot Challenge] ${err.message}. Forcing Playwright fallback for the next retry.`);
      options.forcePlaywright = true;
      await job.updateData({ ...job.data, options });
      throw err;
    }
    if (err.name === 'ExtractionValidationError') {
      job.log(`[Validation Error] ${err.message}. Triggering BullMQ retry with new proxy.`);
      throw err;
    }
    job.log(`Extraction failed: ${err.message}`);
    throw err;
  } finally {
    // Only close context and page, keeping the browser instance alive
    await context.close();
  }
};

const startWorker = async () => {
  await initBrowser();

  const worker = new Worker('scrape-jobs', async (job) => {
    return runScraper(job);
  }, { 
    connection: redis,
    concurrency: 5 // Process 5 jobs concurrently per worker instance
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

    const webhookUrl = job.data?.options?.webhook_url;
    if (webhookUrl) {
      try {
        console.log(`Delivering webhook for job ${job.id} to ${webhookUrl}...`);
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: job.id,
            status: 'completed',
            data: result
          })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        console.log(`Webhook delivered successfully for job ${job.id}`);
      } catch (e: any) {
        console.error(`Failed to deliver webhook for job ${job.id}: ${e.message}`);
      }
    }
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} has failed with ${err.message}`);
    if (job) {
      publisher.publish(`job_events:${job.id}`, JSON.stringify({ status: 'failed', error: err.message }));
    }
  });

  console.log('Worker is running and listening to scrape-jobs...');
};

startWorker().catch(err => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
