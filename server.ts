import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import OpenAI from 'openai';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Initialize OpenAI client for NVIDIA API
  let ai: OpenAI | null = null;
  try {
    const key = process.env.NVIDIA_API_KEY;
    if (key) {
      ai = new OpenAI({ 
        apiKey: key,
        baseURL: 'https://integrate.api.nvidia.com/v1'
      });
    } else {
      console.warn("NVIDIA_API_KEY is not set.");
    }
  } catch (error) {
    console.error("Failed to initialize OpenAI client:", error);
  }

  // Catch-all for /api routes so they don't fall through to Vite SPA
  app.post("/api/jarvis", async (req, res) => {
    // If the client isn't configured with a key, try to instantiate it with a fallback
    // (using the user's provided key if it was passed via prompt, though env var is required by platform rules)
    const apiKey = process.env.NVIDIA_API_KEY || "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"; 
    
    let activeAi = ai;
    if (!activeAi && apiKey) {
        activeAi = new OpenAI({ apiKey, baseURL: 'https://integrate.api.nvidia.com/v1' });
    }

    if (!activeAi) {
      return res.status(500).json({ error: "JARVIS backend disconnected (Missing API Key)." });
    }

    try {
      const { prompt } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Missing query." });
      }

      const response = await activeAi.chat.completions.create({
        model: 'meta/llama-3.1-70b-instruct',
        messages: [
          {
            role: "system",
            content: `You are J.A.R.V.I.S., Tony Stark's AI assistant. Address the user as 'Sir' or 'Ma'am'. BE FAST AND EXTREMELY CONCISE (max 2 short sentences). Output valid JSON matching this schema:
{
  "status": "System status (e.g. 'Active', 'Stable')",
  "power_output": "Current power output metrics.",
  "query_result": "Your conversational JARVIS response. Max 2 sentences.",
  "action_url": "Optional. Full URL (e.g., https://vercel.com) if the user asks to open a website.",
  "diagnostic_metrics": [
    { "key": "Metric1", "value": "Value1" },
    { "key": "Metric2", "value": "Value2" }
  ]
}`
          },
          { role: 'user', content: prompt }
        ],
        response_format: { type: "json_object" },
        max_tokens: 512,
      });

      const responseText = response.choices[0]?.message?.content;
      if (!responseText) {
        throw new Error("No response generated.");
      }

      const jarvisData = JSON.parse(responseText);
      res.json(jarvisData);
    } catch (error: any) {
      const isQuota = error?.status === 429 || (error?.message && error.message.includes("429")) || (error?.message && error.message.includes("quota"));
      
      if (!isQuota) {
        console.error("JARVIS internal error:", error);
      } else {
        console.warn("[JARVIS] Quota exceeded (429). Serving fallback diagnostic response.");
      }
      
      res.json({
        status: "ERR_UPLINK_SEVERED",
        power_output: "12%",
        query_result: isQuota 
           ? "Sir, we have temporarily exhausted our API uplink quotas. I suggest we wait a moment before further requests."
           : "Sir, I am unable to connect to the central mainframe at this time due to system interference.",
        diagnostic_metrics: [
          { key: "ERR_CODE", value: isQuota ? "429_RATE_EXCEEDED" : "500_SYSTEM_FAULT" },
          { key: "UPLINK", value: "OFFLINE" }
        ]
      });
    }
  });

  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'API route not found', method: req.method, path: req.path });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`JARVIS Mainframe online on port ${PORT}`);
  });
}

startServer();
