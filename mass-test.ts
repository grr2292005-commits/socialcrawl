import fs from 'fs';

const API_BASE = 'http://localhost:3000';
const API_KEY = 'dev-key-123';

const testProfiles = [
  { platform: 'twitter', url: 'https://x.com/elonmusk' },
  { platform: 'github', url: 'https://github.com/torvalds' },
  { platform: 'reddit', url: 'https://www.reddit.com/user/deepfuckingvalue' },
  { platform: 'medium', url: 'https://medium.com/@tim_denning' },
  { platform: 'producthunt', url: 'https://www.producthunt.com/@rrhoover' },
  { platform: 'hackernews', url: 'https://news.ycombinator.com/user?id=pg' },
  { platform: 'linkedin', url: 'https://www.linkedin.com/in/williamhgates' },
  { platform: 'youtube', url: 'https://www.youtube.com/@mkbhd' },
  { platform: 'instagram', url: 'https://www.instagram.com/zuck' }
];

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function triggerWarming(platform: string, url: string) {
  try {
    await fetch(`${API_BASE}/warm`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({ platform, url })
    });
  } catch (e) {}
}

async function runJob(profile: { platform: string, url: string }) {
  const startTime = Date.now();
  const TIMEOUT_MS = 120000;
  
  try {
    const postRes = await fetch(`${API_BASE}/scrape`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        platform: profile.platform,
        url: profile.url,
        options: { formats: ['markdown', 'metadata'] }
      })
    });
    
    if (!postRes.ok) {
      throw new Error(`HTTP ${postRes.status}: ${await postRes.text()}`);
    }

    const { jobId } = await postRes.json() as any;
    
    while (Date.now() - startTime < TIMEOUT_MS) {
      await sleep(2000);
      const checkRes = await fetch(`${API_BASE}/jobs/${jobId}`, {
        headers: { 'Authorization': `Bearer ${API_KEY}` }
      });
      const jobStatus = await checkRes.json() as any;

      process.stdout.write(`\r[Job ${jobId}] ${profile.platform}: ${jobStatus.status}    `);

      if (jobStatus.status === 'completed') {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        return {
          platform: profile.platform,
          target: profile.url,
          success: true,
          duration: `${duration}s`,
          extractedData: jobStatus.data
        };
      } else if (jobStatus.status === 'failed') {
        return {
          platform: profile.platform,
          target: profile.url,
          success: false,
          error: jobStatus.failedReason
        };
      }
    }
    
    return {
      platform: profile.platform,
      target: profile.url,
      success: false,
      error: 'timeout'
    };
  } catch (error: any) {
    return {
      platform: profile.platform,
      target: profile.url,
      success: false,
      error: error.message
    };
  }
}

async function runMassTest() {
  console.log(`Starting CONCURRENT benchmark for ${testProfiles.length} profiles...`);

  await triggerWarming('linkedin', 'https://www.linkedin.com');
  await triggerWarming('instagram', 'https://www.instagram.com');
  await sleep(10000);

  const results = await Promise.all(testProfiles.map(profile => runJob(profile)));

  fs.writeFileSync('result.json', JSON.stringify(results, null, 2));
  
  console.log('\n\n--- FINAL RESULTS ---');
  results.forEach(r => {
    const status = r.success ? '✅ OK' : '❌ FAIL';
    const contentLen = r.extractedData?.markdown?.length || 0;
    const blockDetected = r.extractedData?.markdown?.includes('Just a moment...') || 
                        r.extractedData?.markdown?.includes('Verify you are human') ||
                        r.extractedData?.markdown?.includes('404 PAGE NOT FOUND');
    
    let finalStatus = status;
    if (r.success && (contentLen < 100 || blockDetected)) {
      finalStatus = '⚠️ SPARSE/BLOCK';
    }

    console.log(`${finalStatus.padEnd(15)} | ${r.platform.padEnd(12)} | ${r.duration || 'N/A'} | ${r.error || (contentLen + ' chars')}`);
  });
  
  console.log('\n🎉 Test complete! Results saved to result.json');
}

runMassTest();
