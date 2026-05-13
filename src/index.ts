import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const fastify = Fastify({ logger: true });
fastify.register(fastifyWebsocket);

// Initialize Redis and Queues
const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});
const scrapeQueue = new Queue('scrape-jobs', { connection: redis });
const queueEvents = new QueueEvents('scrape-jobs', { connection: redis });

// Helper: URL Validation
const isValidUrl = (url: string) => {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
};

// GET /health
fastify.get('/health', async () => {
  return { status: 'ok' };
});

// POST /scrape
fastify.post('/scrape', async (request, reply) => {
  const body = request.body as any;
  
  if (!isValidUrl(body.url)) {
    return reply.status(400).send({ error: 'Bad Request', message: 'Invalid or missing URL' });
  }

  const jobData = {
    platform: body.platform,
    url: body.url,
    options: body.options
  };

  const job = await scrapeQueue.add('scrape-job', jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  });

  try {
    const result = await job.waitUntilFinished(queueEvents, 120000);
    return reply.status(200).send({
      success: true,
      data: result
    });

  } catch (err: any) {
    return reply.status(500).send({
      success: false,
      error: 'Timeout',
      message: err.message || 'Job timed out after 120 seconds'
    });
  }
});

// POST /crawl
fastify.post('/crawl', async (request, reply) => {
  const { url, maxDepth = 1, maxPages = 5, options = {} } = request.body as any;
  
  if (!isValidUrl(url)) {
    return reply.status(400).send({ error: 'Bad Request', message: 'Invalid or missing URL' });
  }

  const job = await scrapeQueue.add('scrape-job', { 
    url, 
    options: { 
      ...options,
      isCrawl: true, 
      maxDepth, 
      maxPages
    } 
  }, {
    attempts: 1
  });

  try {
    const result = await job.waitUntilFinished(queueEvents, 300000);
    return reply.status(200).send({
      success: true,
      data: result
    });
  } catch (err: any) {
    return reply.status(500).send({
      success: false,
      error: 'Crawl Timeout',
      message: err.message || 'Crawl job timed out after 5 minutes'
    });
  }
});

// GET /jobs/:id
fastify.get('/jobs/:id', async (request, reply) => {
  const { id } = request.params as any;
  const job = await scrapeQueue.getJob(id);

  if (!job) {
    return reply.status(404).send({ error: 'Job not found' });
  }

  const state = await job.getState();
  return {
    jobId: job.id,
    status: state,
    progress: job.progress,
    data: job.returnvalue || null,
    failedReason: job.failedReason
  };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    fastify.log.info('API Gateway started on port 3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
