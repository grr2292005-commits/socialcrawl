# API Specifications

The platform provides a RESTful API and WebSocket support for real-time streaming of scrape results. All endpoints require authentication via Bearer token (API Key).

## Base URL
`https://api.socialcrawl.dev/v1`

## Authentication
Pass your API key in the `Authorization` header:
`Authorization: Bearer sc_xxxxxxxxx`

## Endpoints

### 1. Submit a Scrape Job
`POST /scrape`

Submits a highly targeted scrape job (single entity or search).

**Request Body:**
```json
{
  "platform": "twitter",
  "url": "https://x.com/elonmusk",
  "type": "profile", // profile, post, search, comments
  "options": {
    "waitForSelectors": [".timeline"],
    "maxDepth": 1,
    "limit": 100, // max posts/comments to extract
    "formats": ["markdown", "json", "embeddings"],
    "webhook_url": "https://myapp.com/webhook"
  }
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "uuid-1234-5678",
  "status_url": "https://api.socialcrawl.dev/v1/jobs/uuid-1234-5678"
}
```

### 2. Submit a Crawl Job
`POST /crawl`

Submits an autonomous crawl job (e.g., "Find all profiles mentioning X").

**Request Body:**
```json
{
  "platform": "linkedin",
  "query": "site:linkedin.com/in/ \"distributed systems\"",
  "options": {
    "maxPages": 10,
    "formats": ["markdown"],
    "webhook_url": "https://myapp.com/webhook"
  }
}
```

### 3. Check Job Status / Get Results
`GET /jobs/:jobId`

**Response (200 OK - Processing):**
```json
{
  "jobId": "uuid-1234-5678",
  "status": "processing",
  "progress": 45,
  "data": null
}
```

**Response (200 OK - Completed):**
```json
{
  "jobId": "uuid-1234-5678",
  "status": "completed",
  "data": {
    "platform": "twitter",
    "type": "profile",
    "metadata": {
      "author": "Elon Musk",
      "followers": 150000000,
      "description": "..."
    },
    "markdown": "# Elon Musk\n...",
    "json_data": [ ... ],
    "embeddings_ready_chunks": [
      { "text": "...", "metadata": { "source": "...", "timestamp": "..." } }
    ]
  }
}
```

### 4. WebSocket Stream
`GET /stream/:jobId`

Initiate a WebSocket connection to stream results in real-time.

**Client Message:**
```json
{ "action": "subscribe", "jobId": "uuid-1234-5678", "api_key": "sc_xxxx" }
```

**Server Message (Event):**
```json
{
  "event": "data",
  "payload": {
    "chunk_id": "chunk-1",
    "markdown": "..."
  }
}
```

## Rate Limits
- Free tier: 10 requests / minute
- Pro tier: 100 requests / minute
- Enterprise: Custom
Headers returned: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
