# Deployment & Scaling Strategy

The platform is designed to be cloud-native and highly available.

## Docker Deployment (Single Node / MVP)

For local development and small-scale self-hosting, we provide a `docker-compose.yml` that spins up the entire stack.

**Components:**
1. `api`: The Node.js Fastify API server.
2. `worker`: 1-N instances of the Playwright worker.
3. `postgres`: Database.
4. `redis`: Queue and cache.

## Kubernetes Deployment (Enterprise Scale)

For massive scale, the platform is deployed via Helm to a Kubernetes cluster.

### Architecture

1.  **Ingress:** Nginx or Traefik handling SSL termination and routing to the API gateway.
2.  **API Deployment:** Stateless pods scaling automatically based on CPU/RAM or concurrent HTTP requests (HPA).
3.  **Worker StatefulSet / Deployment:** Stateless Playwright workers.
    *   *Scaling metric:* Scaled via KEDA (Kubernetes Event-driven Autoscaling) based on the length of the BullMQ Redis queues. If `scrape-queue` > 1000, spin up more worker pods.
4.  **Database Cluster:** PostgreSQL managed by an operator (e.g., CrunchyData PGO) for high availability, pooling (PgBouncer), and backups.
5.  **Cache Cluster:** Redis cluster.

### Handling Browser Resource Limits

Browser automation is RAM/CPU intensive.
*   **Pod Resource Limits:** Each worker pod is strictly limited (e.g., 2GB RAM, 1 CPU).
*   **Concurrency Limits:** BullMQ concurrency is tuned to the pod size (e.g., max 5 concurrent Playwright contexts per pod) to prevent Out of Memory (OOM) kills.

## Observability

*   **Logs:** All services output structured JSON logs. Shipped via FluentBit to Elasticsearch/Datadog.
*   **Metrics (Prometheus):**
    *   API Request Latency & Rate
    *   BullMQ Queue Lengths & processing times
    *   Worker CPU/RAM usage
    *   Scrape Success Rate (200s vs 403s/Bans)
*   **Tracing (OpenTelemetry):** Distributed tracing is injected into API requests, spanning through BullMQ to the worker execution to visualize the exact bottleneck in a scrape job.
