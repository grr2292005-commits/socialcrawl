import Fastify, { FastifyRequest } from 'fastify';
import fastifyWebsocket, { SocketStream } from '@fastify/websocket';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const fastify = Fastify({ logger: true });
fastify.register(fastifyWebsocket);

// Initialize Redis and Queues
const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});
const scrapeQueue = new Queue('scrape-jobs', { connection: redis });
const warmingQueue = new Queue('session-warming', { connection: redis });
const queueEvents = new QueueEvents('scrape-jobs', { connection: redis });

// Helper: URL Validation
const isValidUrl = (url: string) => {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
};

// Auth Middleware
fastify.addHook('preHandler', async (request, reply) => {
  if (request.url === '/health') return;
  
  const authToken = process.env.API_AUTH_TOKEN;
  if (!authToken) return; // Auth disabled if no token set

  const authHeader = request.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${authToken}`) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or missing API token' });
  }
});

// GET /health - Exempt from Auth
fastify.get('/health', async () => {
  return { status: 'ok' };
});

// POST /scrape
fastify.post('/scrape', async (request, reply) => {
  const body = request.body as any;
  
  if (!isValidUrl(body.url)) {
    return reply.status(400).send({ error: 'Bad Request', message: 'Invalid or missing URL' });
  }

  const cookies = body.cookies || body.options?.cookies;
  console.log(`[API] Received scrape request for ${body.url} with ${cookies ? cookies.length : 0} cookies`);

  const jobData = {
    platform: body.platform,
    url: body.url,
    cookies: cookies,
    options: body.options
  };
  console.log(`[API] Adding job to queue with keys: ${Object.keys(jobData).join(', ')}`);

  const job = await scrapeQueue.add('scrape-job', jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  });

  try {
    const result = await job.waitUntilFinished(queueEvents, 120000);
    return reply.status(200).send({
      success: true,
      version: "v4.8-HYBRID-SUCCESS",
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
      version: "v4.8-HYBRID-SUCCESS",
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

// POST /warm
fastify.post('/warm', async (request, reply) => {
  const { platform, url } = request.body as any;
  
  if (!isValidUrl(url)) {
    return reply.status(400).send({ error: 'Bad Request', message: 'Invalid or missing URL' });
  }

  const job = await warmingQueue.add('warm-session', {
    platform,
    url
  });

  return reply.status(202).send({
    success: true,
    jobId: job.id
  });
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

// WS /stream/:id
fastify.register(async function (app) {
  app.get('/stream/:id', { websocket: true }, (connection: SocketStream, req: FastifyRequest) => {
    const { id } = req.params as any;
    
    const subscriber = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: null,
    });

    const channel = `job_events:${id}`;

    subscriber.subscribe(channel);

    subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        connection.socket.send(message);
        
        try {
          const parsed = JSON.parse(message);
          if (parsed.status === 'completed' || parsed.status === 'failed') {
            subscriber.quit();
            connection.socket.close();
          }
        } catch (e) {}
      }
    });

    connection.socket.on('close', () => {
      subscriber.quit();
    });
  });
});

const start = async () => {
  try {
    console.log('--- SOCIALCRAWL API STARTING (VER: 4.1.0-DEBUG) ---');
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    fastify.log.info('API Gateway started on port 3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
