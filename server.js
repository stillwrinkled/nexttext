import express from "express";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT || 8080);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const ALLOWED_MODES = new Set(["reply", "opener"]);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "nexttext-backend",
    timestamp: new Date().toISOString()
  });
});

app.post("/v1/nexttext/generate", async (req, res) => {
  try {
    const { mode, input, vibe, styleInstructions, forceRefresh } = req.body ?? {};
    const cleanedMode = typeof mode === "string" ? mode.trim().toLowerCase() : "";
    const cleanedInput = typeof input === "string" ? input.trim() : "";
    const cleanedVibe = typeof vibe === "string" ? vibe.trim() : "Flirty";
    const cleanedStyle = typeof styleInstructions === "string" ? styleInstructions.trim() : "";

    if (!ALLOWED_MODES.has(cleanedMode)) {
      return res.status(400).json({
        error: "Invalid mode. Use 'reply' or 'opener'."
      });
    }

    if (!cleanedInput) {
      return res.status(400).json({
        error: "Input cannot be empty."
      });
    }

    if (String(process.env.MOCK_RESPONSES || "").toLowerCase() === "true") {
      const items = buildMockItems({
        mode: cleanedMode,
        input: cleanedInput,
        vibe: cleanedVibe
      });

      const payload = {
        mode: cleanedMode,
        items,
        meta: {
          model: "mock",
          forceRefresh: Boolean(forceRefresh)
        }
      };
      if (cleanedMode === "reply") payload.replies = items;
      if (cleanedMode === "opener") payload.openers = items;
      return res.json(payload);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Server misconfigured: OPENAI_API_KEY is missing."
      });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const prompt = buildPrompt({
      mode: cleanedMode,
      input: cleanedInput,
      vibe: cleanedVibe,
      styleInstructions: cleanedStyle
    });

    const openAIResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.9,
        messages: [
          {
            role: "system",
            content:
              "You write natural texting language. Return only JSON with a top-level key `items` that contains an array of 4 strings."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const raw = await openAIResponse.text();
    if (!openAIResponse.ok) {
      return res.status(openAIResponse.status).json({
        error: "OpenAI request failed.",
        details: safeSnippet(raw)
      });
    }

    let parsedOuter;
    try {
      parsedOuter = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "OpenAI response was not valid JSON.",
        details: safeSnippet(raw)
      });
    }

    const content = parsedOuter?.choices?.[0]?.message?.content;
    const items = extractItems(content);

    if (!items.length) {
      return res.status(502).json({
        error: "Could not parse generated items from OpenAI response.",
        details: safeSnippet(typeof content === "string" ? content : raw)
      });
    }

    const payload = {
      mode: cleanedMode,
      items,
      meta: {
        model,
        forceRefresh: Boolean(forceRefresh)
      }
    };

    if (cleanedMode === "reply") payload.replies = items;
    if (cleanedMode === "opener") payload.openers = items;

    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      error: "Unexpected server error.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.listen(port, () => {
  console.log(`nexttext-backend listening on port ${port}`);
});

function buildPrompt({ mode, input, vibe, styleInstructions }) {
  const isReply = mode === "reply";
  const taskText = isReply
    ? "Generate 4 different short text-message replies."
    : "Generate 4 different short conversation openers.";

  return [
    taskText,
    "Tone vibe: " + vibe + ".",
    styleInstructions ? "Style rules: " + styleInstructions : "Style rules: keep it natural, concise, and human.",
    isReply ? `Original message to reply to: "${input}"` : `Context for opener: "${input}"`,
    "Output format requirement: return strict JSON object with key `items` and exactly 4 strings.",
    "No markdown, no explanation, no extra keys."
  ].join("\n");
}

function extractItems(content) {
  if (typeof content !== "string" || !content.trim()) {
    return [];
  }

  const trimmed = content.trim();
  const direct = parseItemsFromJSONText(trimmed);
  if (direct.length) return direct;

  const arraySlice = extractFirstArrayText(trimmed);
  if (arraySlice) {
    try {
      const arr = JSON.parse(arraySlice);
      if (Array.isArray(arr)) return sanitizeItems(arr);
    } catch {
      // no-op
    }
  }

  const objectSlice = extractFirstObjectText(trimmed);
  if (objectSlice) {
    return parseItemsFromJSONText(objectSlice);
  }

  const fallback = trimmed
    .split("\n")
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter(Boolean);

  return sanitizeItems(fallback);
}

function parseItemsFromJSONText(text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return sanitizeItems(parsed);
    }
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.items)) return sanitizeItems(parsed.items);
      if (Array.isArray(parsed.replies)) return sanitizeItems(parsed.replies);
      if (Array.isArray(parsed.openers)) return sanitizeItems(parsed.openers);
    }
  } catch {
    return [];
  }

  return [];
}

function sanitizeItems(items) {
  const out = [];
  const seen = new Set();

  for (const item of items) {
    const text = String(item ?? "").trim();
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length === 4) break;
  }

  return out;
}

function extractFirstArrayText(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || start >= end) return "";
  return text.slice(start, end + 1);
}

function extractFirstObjectText(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || start >= end) return "";
  return text.slice(start, end + 1);
}

function safeSnippet(value) {
  return String(value ?? "").slice(0, 800);
}

function buildMockItems({ mode, input, vibe }) {
  const seed = input.split(/\s+/).slice(0, 4).join(" ");
  if (mode === "reply") {
    return [
      `${vibe} energy, I like that 😄`,
      `Haha fair. Tell me more about ${seed}.`,
      `That sounds fun, what are you thinking?`,
      `I am in. What time works for you?`
    ];
  }

  return [
    `Hey, random but you seem fun. How is your day going?`,
    `Quick one: what is your go-to comfort plan after a long day?`,
    `You give good ${vibe.toLowerCase()} vibes. Coffee or chai person?`,
    `I wanted to say hi, what is one thing you are excited about this week?`
  ];
}
