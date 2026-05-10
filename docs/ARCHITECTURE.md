# System Architecture: Open-Core Social Media Intelligence Platform

## High-Level Architecture Overview

The platform is designed as a highly scalable, distributed system, mimicking the robustness of venture-scale infrastructure platforms like Firecrawl. It adopts an open-core model, prioritizing self-hostability (Docker/Kubernetes) while enabling massive horizontal scalability.

### Core Components

1.  **API Gateway & Web Server (Fastify/Node.js):** The entry point for all client interactions. Handles REST APIs, WebSockets for streaming data, authentication, rate limiting, and job submission.
2.  **Queue Manager & Dispatcher (Redis + BullMQ):** The backbone of the asynchronous crawling engine. Manages job queues, priorities, retries, and rate limiting per platform. (Easily swappable with Kafka for enterprise scale).
3.  **Distributed Browser Workers (Playwright + Stealth Plugins):** A fleet of stateless worker nodes responsible for executing browser automation. They pick up jobs from BullMQ, manage browser lifecycles, and handle anti-bot evasions.
4.  **Extraction & Normalization Engine:** Processes raw DOM/API responses into structured formats. Operates locally within workers to minimize data transfer of raw HTML.
5.  **LLM Formatting Pipeline:** Transforms structured data into LLM-optimized formats (Markdown, chunked JSON, vector-ready structures).
6.  **Proxy & Fingerprint Manager:** A dedicated microservice managing proxy rotation, sticky sessions, browser fingerprint generation, and IP health monitoring.
7.  **Data Storage Layer:**
    *   **PostgreSQL:** Primary database for user accounts, API keys, job metadata, billing, and system configuration.
    *   **ClickHouse (Optional/Enterprise):** Analytical database for storing massive volumes of structured scraped data and logs.
    *   **S3/MinIO:** Object storage for raw HTML snapshots, screenshots, and large JSON dumps.
    *   **Redis:** Caching, BullMQ state, rate limiting, and real-time streaming state.

## Architecture Diagram (ASCII)

```text
+-------------------+        +----------------------+        +-------------------+
|                   |        |                      |        |                   |
|  Client / Agent   +<------>+   API Gateway &      +<------>+  PostgreSQL       |
|  (REST/WebSocket) |        |   Web Server         |        |  (Meta & Jobs)    |
|                   |        |   (Fastify, Auth)    |        |                   |
+-------------------+        +----------+-----------+        +-------------------+
                                        |                              ^
                                        v                              |
                             +----------+-----------+                  |
                             |                      |                  |
                             |  Queue & Dispatch    |                  |
                             |  (Redis + BullMQ)    |                  |
                             |                      |                  |
                             +----+------------+----+                  |
                                  |            |                       |
          +-----------------------+            +-----------------------+
          |                                                            |
          v                                                            v
+---------+---------+                                        +---------+---------+
| Browser Worker    |       +------------------------+       | Browser Worker    |
| (Playwright)      +<----->+ Proxy & Fingerprint    +<----->+ (Playwright)      |
|                   |       | Management Service     |       |                   |
| + Scraper SDK     |       +------------------------+       | + Scraper SDK     |
| + Extractor       |                                        | + Extractor       |
| + LLM Formatter   |       +------------------------+       | + LLM Formatter   |
|                   +------>+ S3 / MinIO Storage     +<------+                   |
+---------+---------+       | (Raw DOM, Media)       |       +---------+---------+
          |                 +------------------------+                 |
          |                                                            |
          +-----------------------+            +-----------------------+
                                  |            |
                                  v            v
                             +----+------------+----+
                             |                      |
                             | Target Social Media  |
                             | Platforms            |
                             |                      |
                             +----------------------+
```

## Distributed Worker Design

Workers are entirely stateless. Their lifecycle is:
1. **Pull Job:** Retrieve a scraping task from BullMQ.
2. **Context Setup:** Request a proxy and a matching browser fingerprint from the Proxy Manager.
3. **Browser Launch:** Launch Playwright instance (headful/headless based on stealth requirements) utilizing isolated BrowserContexts.
4. **Execution:** Load the platform adapter (e.g., `TwitterScraper`), execute the workflow (login, search, scroll).
5. **Extraction:** Run DOM selectors or intercept API responses.
6. **Transformation:** Pipe data through the Normalizer and LLM Formatter.
7. **Persistence & Callback:** Store results (S3/DB), emit WebSocket event, and complete the BullMQ job.
8. **Teardown:** Close context. Release proxy.

## Tech Stack Decisions

*   **Backend:** TypeScript + Node.js (Fastify). Chosen for high async throughput and excellent ecosystem for browser automation.
*   **Queue:** BullMQ + Redis. Extremely robust for Node.js distributed queuing, supports delayed jobs, rate limiting, and parent/child jobs for complex crawling graphs.
*   **Automation:** Playwright. Superior to Puppeteer for handling multiple contexts, network interception, and cross-browser stealth capabilities.
*   **Database:** PostgreSQL. ACID compliant, excellent JSONB support for flexible metadata storage.

## Queue Lifecycle & Flow

1. **`scrape:submit`**: User calls POST `/scrape`. Job is added to `scrape-queue`.
2. **`scrape:process`**: Worker picks up job.
   * If pagination is required, worker creates *child jobs* for subsequent pages and pushes them back to `scrape-queue`.
3. **`scrape:extract`**: Worker extracts data.
4. **`scrape:format`**: Data is transformed into LLM-ready markdown/JSON.
5. **`scrape:complete`**: Final payload is constructed. Webhooks fired. WebSocket emitted.
