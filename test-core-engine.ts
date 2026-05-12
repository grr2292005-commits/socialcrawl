import { chromium } from 'playwright';
import { DefaultAdapter } from './src/adapters/DefaultAdapter';
import fs from 'fs';

async function runTest() {
  console.log("Launching browser for core engine test...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  const url = "https://stripe.com";
  console.log(`Navigating to ${url}...`);
  
  try {
    const adapter = new DefaultAdapter();
    const result = await adapter.extract(page, url, { formats: ['markdown', 'chunked', 'metadata'] });
    
    if (result.success) {
      console.log("Saving result to test-output.json...");
      fs.writeFileSync('test-output.json', JSON.stringify(result, null, 2));
      console.log("Done! Check test-output.json");
    } else {
      console.error("Extraction failed:", result.error);
    }
    
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await browser.close();
  }
}

runTest();
