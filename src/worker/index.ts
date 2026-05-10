import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { chromium } from 'playwright-extra';
// @ts-ignore
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { AdapterFactory } from '../adapters/AdapterFactory';

chromium.use(stealthPlugin());

const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

// This simulates the plugin system
const runScraper = async (job: Job) => {
  const { platform, url, options = {} } = job.data;
  
  job.log(`Starting scrape for ${platform || 'auto'} at ${url}`);
  
  // 1. Launch Browser
  const browser = await chromium.launch({
    headless: true, // or false for stealth
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  try {
    // 2. Execute Navigation
    await job.updateProgress(10);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Additional wait for network idle to ensure dynamic content loads
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch(e) {
      console.log('networkidle timeout, proceeding anyway.');
    }
    await job.updateProgress(50);
    
    // 3. Transformation & Extraction using Adapter
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
    job.log(`Extraction failed: ${err.message}`);
    throw err;
  } finally {
    await context.close();
    await browser.close();
  }
};

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

worker.on('completed', (job, result) => {
  console.log(`Job ${job.id} has completed!`);
  publisher.publish(`job_events:${job.id}`, JSON.stringify({ status: 'completed', data: result }));
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} has failed with ${err.message}`);
  if (job) {
    publisher.publish(`job_events:${job.id}`, JSON.stringify({ status: 'failed', error: err.message }));
  }
});

console.log('Worker is running and listening to scrape-jobs...');

