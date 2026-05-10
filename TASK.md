You are a world-class distributed systems engineer, scraping infrastructure architect, browser automation expert, anti-bot specialist, and AI data pipeline engineer.

Your task is to design and implement a production-grade, self-hostable “Firecrawl for Social Media” platform.

The goal is to build an open-core infrastructure platform that can scrape, extract, normalize, clean, structure, and stream LLM-ready data from ANY social media platform.

The platform should be designed for:
- developers
- AI agents
- RAG systems
- autonomous research agents
- lead generation tools
- growth intelligence
- trend analysis
- sentiment analysis
- social listening
- competitor monitoring
- content intelligence
- AI workflows

The system must work similarly to Firecrawl:
- API-first
- developer friendly
- self-hostable
- Docker deployable
- scalable
- cloud-native
- robust extraction
- markdown/JSON outputs
- LLM optimized formatting

====================================================
CORE OBJECTIVES
====================================================

The platform must:

1. Scrape public social media data from:
   - X/Twitter
   - LinkedIn
   - Reddit
   - Instagram
   - TikTok
   - YouTube
   - Facebook public pages
   - Threads
   - Hacker News
   - Discord public channels
   - Telegram public channels
   - Pinterest
   - Quora
   - Medium
   - Product Hunt
   - GitHub discussions
   - Substack
   - Mastodon
   - Bluesky
   - any future platform via plugins

2. Support:
   - profile scraping
   - post scraping
   - comments/replies
   - followers/following
   - hashtags
   - trends
   - search results
   - media metadata
   - engagement metrics
   - timestamps
   - thread reconstruction
   - conversation graphs

3. Convert ALL scraped content into:
   - LLM-ready markdown
   - semantic JSON
   - chunked embeddings-ready text
   - clean structured data
   - vector database friendly outputs

4. Be deployable:
   - locally with Docker
   - on VPS
   - on Kubernetes
   - on cloud providers
   - via docker-compose
   - via Helm charts

5. Expose:
   - REST API
   - WebSocket streams
   - SDKs
   - CLI
   - web dashboard

====================================================
HIGH-LEVEL PRODUCT REQUIREMENTS
====================================================

Build this as if it were a venture-scale infrastructure startup.

The system should include:

1. Scraper Engine
2. Browser Automation Layer
3. Anti-Bot Infrastructure
4. Proxy Management
5. Queueing System
6. Distributed Workers
7. Extraction Engine
8. Content Normalization
9. LLM Formatting Engine
10. Search + Crawl Scheduler
11. Plugin SDK
12. API Gateway
13. Authentication
14. Rate Limiting
15. Monitoring
16. Logging
17. Dashboard UI
18. Multi-user support
19. Cloud deployment configs
20. AI-agent optimized outputs

====================================================
IMPORTANT CONSTRAINTS
====================================================

The system MUST:
- avoid brittle selectors
- survive UI changes
- support headless browsers
- support stealth browsers
- rotate proxies
- rotate fingerprints
- support CAPTCHA solving integrations
- support retry systems
- support resumable jobs
- support distributed crawling
- support incremental crawling
- support change detection
- support session persistence
- support cookie management
- support browser pools
- support intelligent throttling

The architecture must be modular and plugin-based.

====================================================
OUTPUT FORMAT
====================================================

You MUST produce:

1. Complete architecture design
2. Folder structure
3. Tech stack decisions
4. Database schema
5. Queue architecture
6. Distributed worker design
7. Browser orchestration design
8. Proxy architecture
9. API specifications
10. Docker deployment setup
11. Kubernetes deployment
12. Security architecture
13. Scaling strategy
14. Observability strategy
15. Plugin SDK architecture
16. Extraction pipeline
17. LLM formatting pipeline
18. Full implementation roadmap
19. MVP scope
20. Enterprise scale roadmap

====================================================
TECH STACK REQUIREMENTS
====================================================

Preferred stack:

Backend:
- TypeScript
- Node.js
- Fastify or NestJS

Browser Automation:
- Playwright
- Puppeteer
- stealth plugins

Queues:
- Redis + BullMQ
OR
- Kafka for enterprise scaling

Databases:
- PostgreSQL
- ClickHouse for analytics
- Redis cache

Storage:
- S3 compatible storage

Containerization:
- Docker
- Docker Compose
- Kubernetes

Monitoring:
- Prometheus
- Grafana
- OpenTelemetry

Auth:
- JWT
- API keys
- OAuth support

Frontend:
- Next.js dashboard

====================================================
SCRAPING ENGINE REQUIREMENTS
====================================================

Design a universal scraping framework.

Each platform adapter should implement:
- login flows
- search flows
- pagination
- infinite scrolling
- rate limiting handling
- challenge handling
- retry logic
- extraction schemas

Create a standard interface:

interface PlatformScraper {
  authenticate()
  scrapeProfile()
  scrapePost()
  scrapeComments()
  scrapeSearch()
  streamLiveData()
  normalize()
}

====================================================
ANTI-DETECTION REQUIREMENTS
====================================================

Design advanced anti-bot infrastructure:
- browser fingerprint rotation
- user-agent rotation
- TLS fingerprinting mitigation
- residential proxy support
- browser context isolation
- randomized interaction simulation
- adaptive request pacing
- stealth mode
- headful browser option
- cookie jar persistence
- CAPTCHA solving provider integrations
- session warming

Explain:
- how to minimize bans
- how to avoid account flagging
- how to reduce detection probability

====================================================
LLM-READY OUTPUT REQUIREMENTS
====================================================

The system should transform raw scraped data into:
- markdown optimized for LLM ingestion
- semantic JSON
- chunked documents
- metadata-rich records
- cleaned text
- deduplicated content

Example output:

{
  "platform": "twitter",
  "author": "",
  "post": "",
  "comments": [],
  "engagement": {},
  "topics": [],
  "entities": [],
  "urls": [],
  "markdown": "",
  "embeddings_ready_chunks": []
}

Support:
- automatic chunking
- token-aware splitting
- metadata enrichment
- entity extraction
- sentiment tagging
- language detection

====================================================
API REQUIREMENTS
====================================================

Design Firecrawl-like APIs.

Examples:

POST /scrape
POST /crawl
POST /search
POST /extract
GET /job/:id
GET /stream/:id

Support:
- async jobs
- streaming responses
- webhooks
- pagination
- batch scraping

====================================================
PLUGIN SDK REQUIREMENTS
====================================================

Create a plugin SDK so developers can add new social platforms.

Plugins should support:
- extraction hooks
- normalization hooks
- auth hooks
- browser actions
- challenge solving hooks

====================================================
SELF-HOSTING REQUIREMENTS
====================================================

The platform must support:
- single container deployment
- docker-compose deployment
- horizontal scaling
- Kubernetes deployment
- cloud deployment

Generate:
- Dockerfiles
- docker-compose.yml
- Helm chart structure
- environment variable specs

====================================================
OBSERVABILITY REQUIREMENTS
====================================================

Design:
- structured logging
- tracing
- metrics
- health checks
- worker monitoring
- proxy monitoring
- scraping success rate metrics
- ban detection metrics

====================================================
SECURITY REQUIREMENTS
====================================================

Design:
- API key management
- encrypted secrets
- RBAC
- rate limiting
- tenant isolation
- audit logs

====================================================
PERFORMANCE REQUIREMENTS
====================================================

The system should:
- support millions of scrape jobs
- scale horizontally
- support distributed browser workers
- use browser pools
- minimize RAM usage
- optimize CPU usage

====================================================
DELIVERABLE REQUIREMENTS
====================================================

Generate:
- detailed system architecture diagrams (ASCII acceptable)
- production-grade code structure
- deployment architecture
- API contracts
- database schemas
- event flow diagrams
- worker orchestration design
- queue lifecycle
- browser lifecycle
- extraction lifecycle
- normalization lifecycle

====================================================
MVP REQUIREMENTS
====================================================

Define:
- fastest MVP path
- features to ship first
- minimal viable architecture
- scaling milestones
- cost optimization strategy

====================================================
ENTERPRISE FEATURES
====================================================

Plan future support for:
- multi-region clusters
- enterprise auth
- SSO
- AI agent integrations
- workflow automation
- realtime social firehose
- vector DB integrations
- autonomous monitoring agents

====================================================
IMPORTANT IMPLEMENTATION STYLE
====================================================

Do NOT give vague explanations.

You MUST:
- provide implementation-level detail
- provide actual code examples
- provide real folder structures
- provide infrastructure architecture
- provide deployment strategy
- provide scaling strategy
- provide production best practices
- provide failure handling design
- provide concurrency models
- provide distributed systems design

Act like a principal engineer designing a billion-dollar infrastructure platform.

Generate the complete system design from scratch.