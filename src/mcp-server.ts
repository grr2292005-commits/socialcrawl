import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "socialcrawl-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const API_BASE = process.env.SOCIALCRAWL_API_URL || "http://localhost:3000";

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "scrape_url",
        description: "Scrape a social media URL or webpage to extract clean markdown, metadata, and chunked text optimized for LLMs. This tool uses a distributed browser automation system to bypass bot detection.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL to scrape (e.g., https://en.wikipedia.org/wiki/Distributed_computing)",
            },
            formats: {
              type: "array",
              items: {
                type: "string",
                enum: ["markdown", "cleaned_html", "text", "chunks", "metadata", "screenshot"]
              },
              description: "The formats to extract. Defaults to ['markdown', 'metadata', 'chunks']"
            }
          },
          required: ["url"],
        },
      },
    ],
  };
});

async function pollJob(jobId: string): Promise<any> {
  const maxRetries = 60; // 5 minutes max
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(`${API_BASE}/jobs/${jobId}`);
    if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
    const data = await res.json();
    if (data.status === "completed") return data.data;
    if (data.status === "failed") throw new Error(data.failedReason || "Job failed");
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error("Job timed out");
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "scrape_url") {
    const { url, formats = ["markdown", "metadata", "chunks"] } = request.params.arguments as any;

    try {
      const res = await fetch(`${API_BASE}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "auto",
          url,
          options: { formats }
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to submit job: ${res.statusText}`);
      }

      const { jobId } = await res.json();
      const result = await pollJob(jobId);

      // Format result for MCP output
      let textOutput = `Scraped URL: ${url}\n\n`;
      if (result.metadata) {
        textOutput += `Metadata:\n${JSON.stringify(result.metadata, null, 2)}\n\n`;
      }
      if (result.markdown) {
        textOutput += `Content (Markdown):\n${result.markdown}\n\n`;
      }
      if (result.chunked_content && result.chunked_content.length > 0) {
        textOutput += `Chunks generated: ${result.chunked_content.length}\n`;
        textOutput += `First Chunk Sample:\n${result.chunked_content[0].text}\n\n`;
      }

      return {
        content: [
          {
            type: "text",
            text: textOutput
          }
        ]
      };
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error scraping URL: ${e.message}`
          }
        ],
        isError: true
      };
    }
  }

  throw new Error("Tool not found");
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SocialCrawl MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in MCP server:", error);
  process.exit(1);
});
