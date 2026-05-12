async function runTest() {
  console.log("Submitting job to API...");
  try {
    const res = await fetch("http://localhost:3000/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "twitter",
        url: "https://x.com/elonmusk",
        wait: true
      })
    });
    
    if (!res.ok) {
      console.error("HTTP Error:", res.status, res.statusText);
      console.log(await res.text());
      process.exit(1);
    }
    
    const data = await res.json();
    console.log("Success:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Test script failed:", err);
  }
}

runTest();
