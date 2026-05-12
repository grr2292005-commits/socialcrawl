import { chromium } from 'playwright';
import { DefaultAdapter } from './src/adapters/DefaultAdapter';
import fs from 'fs';

async function runTest() {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  const url = "https://stripe.com";
  console.log(`Navigating to ${url}...`);
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    
    console.log("Extracting content...");
    const adapter = new DefaultAdapter();
    const result = await adapter.extract(page, url, {});
    
    if (result.markdown) {
      console.log("Saving markdown to stripe-output.md...");
      fs.writeFileSync('stripe-output.md', result.markdown);
      console.log("Done!");
    } else {
      console.error("Extraction failed: No markdown generated.");
    }
    
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await browser.close();
  }
}

runTest();
