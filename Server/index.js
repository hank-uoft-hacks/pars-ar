import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fetch from "node-fetch";
import FormData from "form-data";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const upload = multer({ storage: multer.memoryStorage() });

const ELEVEN = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
const GEMINI_COOLDOWN_MS = Number(process.env.GEMINI_COOLDOWN_MS || 60000);
let nextChatAllowedAt = 0;
const FALLBACK_GENERIC = [
  "Thanks for sharing. What part of that feels most important to you?",
  "Got it. What are you hoping to learn or achieve from this?",
  "That makes sense. What’s one specific thing you’re working on right now?",
  "I hear you. What would a good next step look like for you?",
];

const FALLBACK_FOLLOWUPS = {
  name: [
    "Nice to meet you. What brings you here today?",
    "Great to meet you! Are you here with a team or solo?",
  ],
  work: [
    "That sounds interesting. What do you enjoy most about that?",
    "Cool—what kind of projects do you usually work on?",
  ],
  school: [
    "Nice! What are you studying right now?",
    "Sounds fun—what classes or topics are you into lately?",
  ],
  project: [
    "Awesome—what’s the goal of the project?",
    "Interesting. What’s the hardest part so far?",
  ],
  help: [
    "I can try to help. What’s the main blocker?",
    "Sure—what do you want to figure out first?",
  ],
  nervous: [
    "Totally understandable. What part feels the most awkward?",
    "You’re not alone there. Want a simple opener to try?",
  ],
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickFallback(text = "") {
  const t = String(text || "").toLowerCase();
  if (!t) return pick(FALLBACK_GENERIC);

  if (/(^|\s)(my name is|i'm|im|i am)\s+\w+/.test(t)) return pick(FALLBACK_FOLLOWUPS.name);
  if (/(work|job|career|role|company|startup|business)/.test(t)) return pick(FALLBACK_FOLLOWUPS.work);
  if (/(school|university|college|class|major|study|studying)/.test(t)) return pick(FALLBACK_FOLLOWUPS.school);
  if (/(project|demo|app|build|hack|hackathon|uofthacks)/.test(t)) return pick(FALLBACK_FOLLOWUPS.project);
  if (/(help|stuck|issue|problem|bug|error)/.test(t)) return pick(FALLBACK_FOLLOWUPS.help);
  if (/(nervous|awkward|anxious|shy)/.test(t)) return pick(FALLBACK_FOLLOWUPS.nervous);

  // Light reflection + generic follow-up.
  const trimmed = t.length > 120 ? t.slice(0, 120) + "..." : t;
  const prefix = pick([
    "Thanks for saying that.",
    "I hear you.",
    "That’s helpful context.",
    "Appreciate the detail.",
  ]);
  return `${prefix} You said: "${trimmed}". ${pick(FALLBACK_GENERIC)}`;
}

function parseRetryAfterMs(err) {
  const fallback = GEMINI_COOLDOWN_MS;
  if (!err) return fallback;

  const details = err?.error?.details || err?.details;
  if (Array.isArray(details)) {
    const retry = details.find((d) => d?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo");
    const delay = retry?.retryDelay || "";
    const match = String(delay).match(/(\d+(?:\.\d+)?)s/);
    if (match) return Math.ceil(Number(match[1]) * 1000);
  }

  const msg = String(err?.message || "");
  const jsonStart = msg.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(msg.slice(jsonStart));
      const pDetails = parsed?.error?.details;
      if (Array.isArray(pDetails)) {
        const retry = pDetails.find((d) => d?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo");
        const delay = retry?.retryDelay || "";
        const match = String(delay).match(/(\d+(?:\.\d+)?)s/);
        if (match) return Math.ceil(Number(match[1]) * 1000);
      }
    } catch {
      // ignore parse errors
    }
  }

  return fallback;
}

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// quick health check
app.get("/health", (req, res) => res.json({ ok: true }));

// 1) Speech -> Text (ElevenLabs)
app.post("/stt", upload.single("file"), async (req, res) => {
  try {
    if (!ELEVEN) return res.status(400).json({ error: "Missing ELEVENLABS_API_KEY" });
    if (!req.file) return res.status(400).json({ error: "Missing audio file" });

    console.log(`[STT] bytes=${req.file.buffer.length}`);
    const fd = new FormData();
    fd.append("file", req.file.buffer, { filename: "audio.wav", contentType: "audio/wav" });
    fd.append("model_id", "scribe_v2");

    const r = await fetchWithTimeout("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": ELEVEN, ...fd.getHeaders() },
      body: fd,
    });

    const data = await r.json();
    console.log(`[STT] status=${r.status}`);
    const text = data.text || data.transcript || data?.result?.text || "";
    res.json({ text, raw: data });
  } catch (e) {
    console.error("[STT] error:", e);
    res.status(500).json({ error: String(e) });
  }
});

// 2) Text -> Gemini -> Text
app.post("/chat", async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(400).json({ error: "Missing GEMINI_API_KEY" });
    const now = Date.now();
    if (now < nextChatAllowedAt) {
      const retryAfterMs = nextChatAllowedAt - now;
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000));
      return res.status(429).json({ error: "rate_limited", retryAfterMs });
    }

    const userText = req.body?.text || "";
    if (!userText.trim()) return res.status(400).json({ error: "Missing text" });
    const system =
      "You are a friendly networking coach. Roleplay as a person the user is meeting. " +
      "Ask short follow-up questions. Keep responses under 2-3 sentences.";

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Gemini timeout")), REQUEST_TIMEOUT_MS)
    );
    const resp = await Promise.race([
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: `${system}\n\nUser: ${userText}` }] }],
      }),
      timeoutPromise,
    ]);

    res.json({ text: resp.text ?? "" });
  } catch (e) {
    console.error("[CHAT] error:", e);
    if (e?.status === 429) {
      const retryAfterMs = parseRetryAfterMs(e);
      nextChatAllowedAt = Date.now() + retryAfterMs;
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000));
      return res.status(429).json({ error: "rate_limited", retryAfterMs });
    }
    res.status(500).json({ error: String(e) });
  }
});

// 3) Text -> Speech (ElevenLabs)
app.post("/tts", async (req, res) => {
  try {
    if (!ELEVEN) return res.status(400).json({ error: "Missing ELEVENLABS_API_KEY" });
    if (!VOICE_ID) return res.status(400).json({ error: "Missing ELEVENLABS_VOICE_ID" });

    const text = req.body?.text || "";
    console.log(`[TTS] textLen=${text.length}`);

    const r = await fetchWithTimeout(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
      }),
    });

    if (!r.ok) return res.status(500).send(await r.text());

    const audioBuf = Buffer.from(await r.arrayBuffer());
    console.log(`[TTS] status=${r.status} bytes=${audioBuf.length}`);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuf.length);
    res.send(audioBuf);
  } catch (e) {
    console.error("[TTS] error:", e);
    res.status(500).json({ error: String(e) });
  }
});

const PORT = process.env.PORT || 3100;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running:");
  console.log(`  Local:  http://localhost:${PORT}/health`);
});

