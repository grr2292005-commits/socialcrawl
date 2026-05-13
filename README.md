# SocialCrawl 🕷️ 

*The Open-Core, Venture-Scale Infrastructure Platform for Social Media Intelligence.*

SocialCrawl is a distributed, self-hostable platform designed to extract, clean, and structure data from any social media platform, preparing it instantly for LLMs, RAG systems, and AI agents.

## 📚 Documentation

The complete system design is documented in the `docs/` directory:

*   [System Architecture](./docs/ARCHITECTURE.md)
*   [API Specifications](./docs/API_SPECS.md)
*   [Database Schema](./docs/DATABASE_SCHEMA.md)
*   [Anti-Bot & Browser Defense](./docs/ANTI_BOT.md)
*   [Deployment & Scaling](./docs/DEPLOYMENT.md)

## 🚀 Quick Start (MVP)

The minimal viable product is fully containerized.

1.  **Install Dependencies** (Local Dev):
    ```bash
    npm install
    ```
2.  **Start the Platform** (Docker):
    ```bash
    docker-compose up -d
    ```
3.  **Test an Extraction**:
    ```bash
    curl -X POST http://localhost:3000/scrape \
      -H "Content-Type: application/json" \
      -d '{"platform": "linkedin", "url": "https://www.linkedin.com/in/williamhgates", "options": {"formats": ["markdown"]}}'
    ```

## 🤖 Model Context Protocol (MCP) Integration

SocialCrawl provides a built-in MCP server, allowing AI agents (like Claude Code) to directly access the extraction pipeline as a local tool.

### Setup for Claude Code

1. Ensure the SocialCrawl Docker cluster is running locally (`docker-compose up -d`).
2. Add SocialCrawl to your MCP configuration. Since this project includes a `.mcp.json` file, Claude Code can discover it automatically if you run it from this directory, or you can add it globally:
   ```json
   {
     "socialcrawl": {
       "command": "npx",
       "args": ["ts-node", "/path/to/socialcrawl/src/mcp-server.ts"],
       "env": {
         "SOCIALCRAWL_API_URL": "http://localhost:3000"
       }
     }
   }
   ```
3. Your agent will now have access to the `scrape_url` tool, which leverages the distributed browser network to bypass bots and return clean, chunked Markdown.

## 🗺️ Implementation Roadmap

### Phase 1: Core Engine (MVP - Complete)
*   [x] Distributed Architecture Design
*   [x] API Gateway Scaffolding (Fastify)
*   [x] BullMQ + Redis Queue Implementation
*   [x] Playwright Worker Scaffolding with Stealth Plugins
*   [x] Interface definitions for Platform SDK

### Phase 2: Anti-Bot & Data Pipelines
*   [x] LinkedIn Adapter Implementation (Profile extraction, session injection)
*   [ ] Integrate BrightData / Oxylabs proxy rotation module.
*   [ ] Implement PostgreSQL for job persistence and session warming.
*   [ ] Build the LLM Formatter (Turndown for Markdown, custom chunking for vector DBs).
*   [ ] Develop the first concrete adapter: `LinkedInAdapter` (handling authentication and scrolling).

### Phase 3: Scale & Enterprise
*   [ ] Multi-node Kubernetes deployment with KEDA autoscaling.
*   [ ] Webhook delivery system for completed jobs.
*   [ ] Advanced CAPTCHA solving hooks.
*   [ ] WebSocket streaming for real-time firehose data.

## 🏢 Enterprise Features & Roadmap
*   **Vector DB Integration:** Push scraped data directly into Pinecone/Milvus.
*   **Multi-tenant Auth & RBAC:** Organization-level API keys and rate limiting.
*   **Real-time Event Triggers:** "Notify webhook when a new post matches X criteria."
*   **SOC2 Compliance:** Audit logs, encrypted sessions.
