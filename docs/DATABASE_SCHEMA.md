# Database Schema (PostgreSQL)

The primary database utilizes PostgreSQL. We leverage `JSONB` heavily to accommodate the highly dynamic nature of social media platform metadata while keeping core relational integrity.

## Tables

### `users`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Unique user identifier |
| `email` | VARCHAR | User email |
| `password_hash` | VARCHAR | Hashed password |
| `tier` | VARCHAR | 'free', 'pro', 'enterprise' |
| `created_at` | TIMESTAMPTZ | |

### `api_keys`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | |
| `user_id` | UUID (FK) | References `users.id` |
| `key_hash` | VARCHAR | Hashed API key |
| `prefix` | VARCHAR | First 8 chars for identification (e.g., `fc_xxxx`) |
| `revoked` | BOOLEAN | |
| `created_at` | TIMESTAMPTZ | |

### `jobs`
Stores metadata about the scrape requests. Highly concurrent.
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Job ID |
| `user_id` | UUID (FK) | References `users.id` |
| `type` | VARCHAR | 'profile', 'search', 'post', 'crawl' |
| `platform` | VARCHAR | 'twitter', 'linkedin', 'reddit', etc. |
| `status` | VARCHAR | 'pending', 'active', 'completed', 'failed' |
| `target_url` | TEXT | The initial URL to scrape |
| `options` | JSONB | Depth, limits, proxy settings, LLM formatting flags |
| `result_url` | TEXT | S3 pre-signed URL to the final output |
| `error_log` | TEXT | Stack trace or failure reason |
| `created_at` | TIMESTAMPTZ | |
| `completed_at`| TIMESTAMPTZ | |

### `proxies`
Manages the inventory of available proxies.
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | |
| `url` | TEXT | `http://user:pass@ip:port` |
| `provider` | VARCHAR | 'brightdata', 'oxylabs', 'custom' |
| `country` | VARCHAR | ISO code |
| `status` | VARCHAR | 'active', 'dead', 'cooldown' |
| `fail_count` | INTEGER | Consecutive failures |
| `last_used` | TIMESTAMPTZ | |

### `platform_sessions`
Stores serialized cookies/tokens for specific platforms to avoid re-login.
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | |
| `platform` | VARCHAR | 'twitter', 'linkedin' |
| `proxy_id` | UUID (FK) | The proxy tied to this session |
| `user_agent` | TEXT | The specific user agent used |
| `cookies` | JSONB | Serialized Playwright cookie jar |
| `local_storage`| JSONB | Associated local storage |
| `is_valid` | BOOLEAN | False if login challenged/banned |
| `last_validated`| TIMESTAMPTZ| |

### `webhook_endpoints`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | |
| `user_id` | UUID (FK) | |
| `url` | TEXT | Target URL |
| `secret` | VARCHAR | Signing secret |
| `events` | JSONB | Array of subscribed events |

## Cache Strategy (Redis)

*   **`job:status:{jobId}`**: Real-time status tracker for API polling.
*   **`rate_limit:{userId}`**: Standard API rate limiting.
*   **`platform_rate_limit:{platform}:{proxyId}`**: Tracks scraping pacing to avoid bans per proxy.
