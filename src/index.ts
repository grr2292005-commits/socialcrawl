import Fastify from 'fastify';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const fastify = Fastify({ logger: true });

// Initialize Redis and Queue
const redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});
const scrapeQueue = new Queue('scrape-jobs', { connection: redis });

// GET /health
fastify.get('/health', async () => {
  return { status: 'ok' };
});

// POST /scrape
fastify.post('/scrape', async (request, reply) => {
  const body = request.body as any; // In production, validate with Zod
  
  const job = await scrapeQueue.add('scrape', {
    platform: body.platform,
    url: body.url,
    type: body.type,
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

// GET /jobs/:id
fastify.get('/jobs/:id', async (request, reply) => {
  const { id } = request.params as any;
  const job = await scrapeQueue.getJob(id);

  if (!job) {
    return reply.status(404).send({ error: 'Job not found' });
  }

  const state = await job.getState();
  const progress = job.progress;

  return {
    jobId: job.id,
    status: state,
    progress: progress,
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
