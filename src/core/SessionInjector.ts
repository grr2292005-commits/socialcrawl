import { BrowserContext, Page } from 'playwright';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@postgres:5432/socialcrawl',
});

export class SessionInjector {
  /**
   * Fetches a valid session for the given platform and injects its cookies
   * into the provided Playwright BrowserContext.
   * 
   * NOTE: localStorage injection is permanently disabled to prevent page-level ReferenceErrors.
   * 
   * @param platform The platform name (e.g., 'linkedin')
   * @param context The Playwright BrowserContext to inject cookies into
   * @param _page Playwright Page (unused)
   * @returns boolean indicating if a session was successfully injected
   */
  public static async injectSession(platform: string, context: BrowserContext, _page: Page): Promise<boolean> {
    try {
      const query = `
        SELECT id, cookies 
        FROM platform_sessions 
        WHERE platform = $1 AND is_valid = true 
        ORDER BY last_validated DESC 
        LIMIT 1;
      `;
      const result = await pool.query(query, [platform]);

      if (result.rows.length === 0) {
        return false;
      }

      const session = result.rows[0];

      // 1. Inject Cookies (Safe native Playwright method)
      if (session.cookies) {
        const cookies = typeof session.cookies === 'string' ? JSON.parse(session.cookies) : session.cookies;
        await context.addCookies(cookies);
      }

      // 2. Local Storage injection removed to ensure bulletproof execution
      
      return true;
    } catch (error) {
      console.error(`[SessionInjector] Failed to inject session:`, error);
      return false;
    }
  }
}
