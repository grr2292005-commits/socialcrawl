# Anti-Bot & Browser Orchestration

Social media platforms deploy aggressive anti-bot measures. This platform employs a multi-layered defense to ensure reliable data extraction.

## 1. Browser Orchestration (Playwright)

We use Playwright over Puppeteer for its superior multi-context support and out-of-the-box browser patching.

*   **Browser Context Isolation:** Every job runs in an isolated `BrowserContext`. Cookies, local storage, and cache do not leak between jobs.
*   **Stealth Plugins:** We utilize `playwright-extra` + `puppeteer-extra-plugin-stealth`. This strips common headless markers (e.g., `navigator.webdriver`, masks WebGL fingerprints, fixes missing languages).
*   **Headful vs Headless:** For extremely aggressive platforms (e.g., TikTok, LinkedIn), we support a "headful" mode combined with XVFB (X Virtual Framebuffer) in Docker, mimicking a real desktop environment perfectly.

## 2. Proxy & Network Management

A single IP scraping at scale is guaranteed to be banned.

*   **Proxy Rotation:** Integrated with providers like BrightData or Oxylabs.
*   **Sticky Sessions:** When a session is established (e.g., logging in), the system binds that `BrowserContext` to a specific residential proxy IP. Subsequent requests for that session *must* use the same IP to prevent location-hop bans.
*   **TLS Fingerprinting Mitigation:** We use custom agents or proxy-level TLS masquerading to ensure the Ja3 fingerprints match the declared User-Agent.

## 3. Interaction Simulation

*   **Humanized Scrolling:** Instead of instantly jumping to the bottom of the page, we implement bezier-curve based mouse movements and randomized scroll steps with variable pauses.
*   **Adaptive Pacing:** The system monitors response times and HTTP status codes (like 429s). If detected, it exponentially backs off and increases the delay between actions (clicks, scrolls).

## 4. Session & Cookie Jars

*   **Cookie Farming/Warming:** We maintain a pool of "warm" accounts/sessions. These sessions periodically browse normal content to build a realistic history before being used for heavy extraction.
*   **Persistence:** Cookies and LocalStorage are serialized and stored in PostgreSQL (`platform_sessions`). When a job starts, it requests a warm session, injects the cookies, and bypasses login flows.

## 5. CAPTCHA Solving

*   **Integration:** Hooks are built-in for 2Captcha or CapSolver. If a challenge page is detected (via DOM selectors or URL patterns), execution is paused, the CAPTCHA is solved via API, and the token is injected or clicked to proceed.
