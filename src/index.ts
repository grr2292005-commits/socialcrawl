import Fastify, { FastifyRequest } from 'fastify';
import fastifyWebsocket, { SocketStream } from '@fastify/websocket';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const fastify = Fastify({ logger: true });
fastify.register(fastifyWebsocket);

const API_KEY = process.env.API_KEY || 'dev-key-123';

// Initialize Redis and Queues
const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});
const scrapeQueue = new Queue('scrape-jobs', { connection: redis });
const warmingQueue = new Queue('session-warming', { connection: redis });

// SECURITY: API Key Authentication Hook
fastify.addHook('preHandler', async (request, reply) => {
  if (request.url === '/health') return;

  const authHeader = request.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
    return reply.status(401).send({ 
      error: 'Unauthorized', 
      message: 'Invalid or missing API Key in Authorization header' 
    });
  }
});

// Helper: URL Validation
const isValidUrl = (url: string) => {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
};

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

  const job = await scrapeQueue.add('scrape-job', {
    platform: body.platform,
    url: body.url,
    options: body.options
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  });

  return reply.status(202).send({
    success: true,
    jobId: job.id,
    status_url: `/jobs/${job.id}`
  });
});

// POST /crawl
fastify.post('/crawl', async (request, reply) => {
  const { url, maxDepth = 2, maxPages = 10, options = {} } = request.body as any;
  
  if (!isValidUrl(url)) {
    return reply.status(400).send({ error: 'Bad Request', message: 'Invalid or missing URL' });
  }

  const crawlId = uuidv4();
  const job = await scrapeQueue.add('scrape-job', { 
    url, 
    options: { 
      ...options,
      isCrawl: true, 
      maxDepth, 
      currentDepth: 0, 
      maxPages, 
      crawlId 
    } 
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  });

  return reply.status(202).send({
    success: true,
    crawlId,
    initialJobId: job.id,
    status_url: `/jobs/${job.id}`
  });
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
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    fastify.log.info('API Gateway started on port 3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
