import { BrowserContext, Page } from 'playwright';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@postgres:5432/socialcrawl',
});

export class SessionInjector {
  /**
   * Fetches a valid session for the given platform and injects its cookies and localStorage
   * into the provided Playwright BrowserContext and Page.
   * 
   * @param platform The platform name (e.g., 'twitter')
   * @param context The Playwright BrowserContext to inject cookies into
   * @param page The Playwright Page to inject localStorage into (must be navigated to the domain first)
   * @returns boolean indicating if a session was successfully injected
   */
  public static async injectSession(platform: string, context: BrowserContext, page: Page): Promise<boolean> {
    try {
      const query = `
        SELECT id, cookies, local_storage 
        FROM platform_sessions 
        WHERE platform = $1 AND is_valid = true 
        ORDER BY last_validated DESC 
        LIMIT 1;
      `;
      const result = await pool.query(query, [platform]);

      if (result.rows.length === 0) {
        console.log(`[SessionInjector] No valid session found for platform: ${platform}`);
        return false;
      }

      const session = result.rows[0];
      console.log(`[SessionInjector] Found valid session ${session.id} for ${platform}`);

      // 1. Inject Cookies
      if (session.cookies) {
        const cookies = typeof session.cookies === 'string' ? JSON.parse(session.cookies) : session.cookies;
        await context.addCookies(cookies);
      }

      // 2. Inject Local Storage
      // Note: page must already be navigated to the target origin for localStorage to be set correctly.
      if (session.local_storage) {
        const localStorageData = typeof session.local_storage === 'string' ? JSON.parse(session.local_storage) : session.local_storage;
        
        await page.evaluate((lsData: Record<string, string>) => {
          for (const key in lsData) {
            window.localStorage.setItem(key, lsData[key]);
          }
        }, localStorageData);
      }

      return true;
    } catch (error) {
      console.error(`[SessionInjector] Failed to inject session:`, error);
      return false;
    }
  }
}
