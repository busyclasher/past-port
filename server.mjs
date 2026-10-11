import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { rateLimit } from "express-rate-limit";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.env.PORT || "4173", 10);
const allowedOrigin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const apiKey = process.env.ELEVENLABS_API_KEY || "";
const sessionSecret = process.env.SESSION_SECRET || "";
const production = process.env.NODE_ENV === "production";
const sessionUsage = new Map();

export const app = express();
export default app;
app.disable("x-powered-by");
app.use(express.json({ limit: "2kb", strict: true }));

app.use((req, res, next) => {
  res.set({
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' wss://api.elevenlabs.io; media-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self';",
    "Permissions-Policy": "microphone=(self), camera=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  next();
});

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map(part => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key]) => key));
}

function signature(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function readSession(req) {
  if (!sessionSecret) return null;
  const raw = parseCookies(req.headers.cookie).pastport_voice_session;
  if (!raw) return null;
  const [id, supplied] = raw.split(".");
  if (!id || !supplied) return null;
  const expected = signature(id);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null;
}

function issueSession(res) {
  if (!sessionSecret) return null;
  const id = crypto.randomBytes(24).toString("base64url");
  res.cookie("pastport_voice_session", `${id}.${signature(id)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: production,
    maxAge: 60 * 60 * 1000,
    path: "/",
  });
  return id;
}

function ensurePageSession(req, res, next) {
  if (!readSession(req)) issueSession(res);
  next();
}

function sameOrigin(req, res, next) {
  if (req.get("origin") !== allowedOrigin) return res.status(403).json({ error: "origin_not_allowed" });
  if (req.get("sec-fetch-site") && req.get("sec-fetch-site") !== "same-origin") return res.status(403).json({ error: "cross_site_request" });
  next();
}

const tokenRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: "too_many_requests" }),
});

function consumeSessionAllowance(sessionId) {
  const now = Date.now();
  const recent = (sessionUsage.get(sessionId) || []).filter(time => now - time < 60 * 60 * 1000);
  if (recent.length >= 5 || (recent.at(-1) && now - recent.at(-1) < 10_000)) return false;
  recent.push(now);
  sessionUsage.set(sessionId, recent);
  return true;
}

app.post("/api/scribe-token", tokenRateLimit, sameOrigin, async (req, res) => {
  if (!apiKey || !sessionSecret) return res.status(503).json({ error: "transcription_not_configured" });
  const sessionId = readSession(req);
  if (!sessionId) return res.status(401).json({ error: "invalid_session" });
  if (req.body?.purpose !== "pastport-memory") return res.status(400).json({ error: "invalid_request" });
  if (!consumeSessionAllowance(sessionId)) return res.status(429).json({ error: "session_limit" });

  try {
    const upstream = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(8_000),
    });
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 503;
      return res.status(status).json({ error: status === 429 ? "service_limit" : "token_unavailable" });
    }
    const payload = await upstream.json();
    if (typeof payload.token !== "string" || !payload.token) return res.status(503).json({ error: "token_unavailable" });
    return res.json({ token: payload.token });
  } catch {
    return res.status(503).json({ error: "token_unavailable" });
  }
});

app.get("/api/speech-availability", (_req, res) => {
  res.json({ available: Boolean(apiKey && sessionSecret) });
});

app.get(["/", "/PastPort-interactive.html"], ensurePageSession, (_req, res) => {
  res.sendFile(path.join(currentDir, "PastPort-interactive.html"));
});
app.get("/demo-interactions.css", (_req, res) => res.sendFile(path.join(currentDir, "demo-interactions.css")));
app.get("/demo-interactions.js", (_req, res) => res.sendFile(path.join(currentDir, "demo-interactions.js")));
const photoFiles = new Set(["central-2006.jpg", "central-2022.jpg", "playground-2013.jpg", "playground-2025.jpg", "park-2006.jpg", "park-2011.jpg"]);
app.get("/photos/:file", (req, res) => {
  if (!photoFiles.has(req.params.file)) return res.sendStatus(404);
  return res.sendFile(path.join(currentDir, "photos", req.params.file));
});
app.get("/dist/speech-memory.js", (_req, res) => res.sendFile(path.join(currentDir, "dist", "speech-memory.js")));
app.get("/vendor/scribe-audio-processor.js", (_req, res) => res.sendFile(path.join(currentDir, "node_modules", "@elevenlabs", "client", "worklets", "scribeAudioProcessor.js")));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, "127.0.0.1", () => {
    console.log(`PastPort is available at ${allowedOrigin}`);
    console.log(`ElevenLabs transcription: ${apiKey && sessionSecret ? "configured" : "unavailable (manual reflection remains enabled)"}`);
  });
}
