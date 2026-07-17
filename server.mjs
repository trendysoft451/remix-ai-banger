import "dotenv/config";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const mockJobs = new Map();

const fileRefSchema = z.union([
  z.string().url(),
  z.object({
    name: z.string().min(1),
    id: z.string().optional(),
    mime_type: z.string().min(1),
    download_link: z.string().url(),
  }),
]);

const startSchema = z.object({
  openaiFileIdRefs: z.array(fileRefSchema).length(1),
  style: z.string().trim().min(2).max(200),
  bpm: z.number().int().min(50).max(220).optional(),
  musicalKey: z.string().trim().max(20).optional(),
  intensity: z.number().int().min(1).max(10).default(7),
  preserveVocals: z.boolean().default(true),
  durationSeconds: z.number().int().min(15).max(600).optional(),
  notes: z.string().trim().max(1000).optional(),
});

function envBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isMockMode() {
  return envBoolean("MOCK_MODE", true);
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireApiKey(req, res, next) {
  const expected = process.env.GPT_ACTION_API_KEY;
  if (!expected) return res.status(503).json({ error: "GPT_ACTION_API_KEY is not configured" });
  if (!timingSafeEqualText(req.get("X-API-Key"), expected)) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  return next();
}

function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function normalizeFileRef(ref) {
  if (typeof ref === "string") {
    return { name: "source-audio", mimeType: "application/octet-stream", downloadUrl: ref };
  }
  return { name: ref.name, mimeType: ref.mime_type, downloadUrl: ref.download_link };
}

function assertAudio(file) {
  const allowedByMime = file.mimeType.startsWith("audio/") || file.mimeType === "application/octet-stream";
  const allowedByName = /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name);
  if (!allowedByMime && !allowedByName) {
    const error = new Error("The uploaded file is not a supported audio file");
    error.statusCode = 400;
    throw error;
  }

  const url = new URL(file.downloadUrl);
  if (url.protocol !== "https:") {
    const error = new Error("The audio download URL must use HTTPS");
    error.statusCode = 400;
    throw error;
  }

  if (!envBoolean("ALLOW_ANY_FILE_URL", false)) {
    const allowedHosts = String(process.env.ALLOWED_FILE_HOSTS || "files.oaiusercontent.com")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    const hostname = url.hostname.toLowerCase();
    const allowed = allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    if (!allowed) {
      const error = new Error(`Audio host not allowed: ${hostname}`);
      error.statusCode = 400;
      throw error;
    }
  }
}

function providerHeaders() {
  const headers = {};
  const apiKey = process.env.REMIX_PROVIDER_API_KEY;
  if (apiKey) {
    const headerName = process.env.REMIX_PROVIDER_AUTH_HEADER || "Authorization";
    const scheme = process.env.REMIX_PROVIDER_AUTH_SCHEME ?? "Bearer";
    headers[headerName] = scheme ? `${scheme} ${apiKey}` : apiKey;
  }
  return headers;
}

async function parseProviderResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`Remix provider returned HTTP ${response.status}`);
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    error.details = payload;
    throw error;
  }
  return payload;
}

function mapProviderStatus(value) {
  const status = String(value || "queued").toLowerCase();
  if (["done", "succeeded", "success", "complete", "completed"].includes(status)) return "completed";
  if (["error", "errored", "cancelled", "canceled", "failed"].includes(status)) return "failed";
  if (["running", "rendering", "working", "processing", "in_progress"].includes(status)) return "processing";
  return "queued";
}

function mapStartResponse(payload) {
  const providerJobId = payload.jobId ?? payload.job_id ?? payload.id ?? payload.taskId ?? payload.task_id;
  if (!providerJobId) {
    const error = new Error("Provider response does not contain a job identifier");
    error.statusCode = 502;
    error.details = payload;
    throw error;
  }
  return {
    providerJobId: String(providerJobId),
    status: mapProviderStatus(payload.status ?? payload.state),
    progress: Number.isFinite(Number(payload.progress)) ? Number(payload.progress) : 0,
    outputUrl: payload.outputUrl ?? payload.output_url ?? payload.resultUrl ?? payload.result_url ?? null,
    message: payload.message ?? "Remix accepted by provider",
  };
}

function mapStatusResponse(payload) {
  const progressValue = payload.progress ?? payload.percent ?? payload.percentage;
  return {
    status: mapProviderStatus(payload.status ?? payload.state),
    progress: Number.isFinite(Number(progressValue)) ? Number(progressValue) : undefined,
    outputUrl:
      payload.outputUrl ?? payload.output_url ?? payload.resultUrl ?? payload.result_url ?? payload.audioUrl ?? payload.audio_url ?? null,
    message: payload.message ?? payload.error ?? undefined,
  };
}

function encodeProviderJobId(providerJobId) {
  return `p_${Buffer.from(String(providerJobId), "utf8").toString("base64url")}`;
}

function decodeProviderJobId(publicJobId) {
  if (!publicJobId.startsWith("p_")) return publicJobId;
  try {
    const decoded = Buffer.from(publicJobId.slice(2), "base64url").toString("utf8");
    if (!decoded) throw new Error("empty");
    return decoded;
  } catch {
    const error = new Error("Invalid jobId");
    error.statusCode = 400;
    throw error;
  }
}

async function readBodyWithLimit(response, maxBytes) {
  if (!response.body) return new Uint8Array();
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new Error(`Audio file exceeds ${maxBytes} bytes`);
    error.statusCode = 400;
    throw error;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      const error = new Error(`Audio file exceeds ${maxBytes} bytes`);
      error.statusCode = 400;
      throw error;
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function startWithProvider(file, params) {
  const startUrl = process.env.REMIX_PROVIDER_START_URL;
  if (!startUrl) {
    const error = new Error("REMIX_PROVIDER_START_URL is not configured");
    error.statusCode = 503;
    throw error;
  }

  const timeoutMs = envNumber("PROVIDER_TIMEOUT_MS", 35_000);
  const mode = process.env.REMIX_PROVIDER_MODE || "json-url";
  let response;

  if (mode === "multipart") {
    const sourceResponse = await fetch(file.downloadUrl, {
      signal: AbortSignal.timeout(envNumber("FILE_DOWNLOAD_TIMEOUT_MS", 20_000)),
    });
    if (!sourceResponse.ok) {
      const error = new Error(`Unable to download OpenAI file: HTTP ${sourceResponse.status}`);
      error.statusCode = 400;
      throw error;
    }
    const bytes = await readBodyWithLimit(sourceResponse, envNumber("MAX_AUDIO_BYTES", 50 * 1024 * 1024));
    const form = new FormData();
    form.append("audio", new Blob([bytes], { type: file.mimeType }), file.name);
    form.append("style", params.style);
    if (params.bpm !== undefined) form.append("bpm", String(params.bpm));
    if (params.musicalKey) form.append("musicalKey", params.musicalKey);
    form.append("intensity", String(params.intensity));
    form.append("preserveVocals", String(params.preserveVocals));
    if (params.durationSeconds !== undefined) form.append("durationSeconds", String(params.durationSeconds));
    if (params.notes) form.append("notes", params.notes);

    response = await fetch(startUrl, {
      method: "POST",
      headers: providerHeaders(),
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } else if (mode === "json-url") {
    response = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...providerHeaders() },
      body: JSON.stringify({
        sourceFile: { name: file.name, mimeType: file.mimeType, downloadUrl: file.downloadUrl },
        ...params,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } else {
    const error = new Error("REMIX_PROVIDER_MODE must be json-url or multipart");
    error.statusCode = 503;
    throw error;
  }

  return mapStartResponse(await parseProviderResponse(response));
}

async function getProviderStatus(providerJobId) {
  const template = process.env.REMIX_PROVIDER_STATUS_URL_TEMPLATE;
  if (!template || !template.includes("{jobId}")) {
    const error = new Error("REMIX_PROVIDER_STATUS_URL_TEMPLATE must contain {jobId}");
    error.statusCode = 503;
    throw error;
  }
  const url = template.replace("{jobId}", encodeURIComponent(providerJobId));
  const response = await fetch(url, {
    headers: providerHeaders(),
    signal: AbortSignal.timeout(envNumber("PROVIDER_TIMEOUT_MS", 35_000)),
  });
  return mapStatusResponse(await parseProviderResponse(response));
}

function publicJob(job) {
  const result = {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
  if (job.outputUrl) {
    result.outputUrl = job.outputUrl;
    if (envBoolean("RETURN_FILE_TO_CHATGPT", false)) result.openaiFileResponse = [job.outputUrl];
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined && value !== null));
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: envNumber("RATE_LIMIT_PER_MINUTE", 30),
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );

  app.get("/", (req, res) => {
    const baseUrl = publicBaseUrl(req);
    res.json({
      service: "remix-banger-gpt-action",
      status: "online",
      mode: isMockMode() ? "mock" : "provider",
      health: `${baseUrl}/health`,
      openapi: `${baseUrl}/openapi.yaml`,
      privacyPolicy: `${baseUrl}/privacy-policy`,
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "remix-banger-gpt-action", mode: isMockMode() ? "mock" : "provider" });
  });

  app.get("/openapi.yaml", async (req, res, next) => {
    try {
      const template = await readFile(path.join(rootDir, "openapi.template.yaml"), "utf8");
      res.type("application/yaml").send(template.replaceAll("__PUBLIC_BASE_URL__", publicBaseUrl(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/privacy-policy", (_req, res) => {
    res.sendFile(path.join(rootDir, "privacy-policy.html"));
  });

  app.post("/v1/remixes/professional", requireApiKey, async (req, res, next) => {
    try {
      const parsed = startSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const { openaiFileIdRefs, ...params } = parsed.data;
      const file = normalizeFileRef(openaiFileIdRefs[0]);
      assertAudio(file);
      const now = new Date().toISOString();

      if (isMockMode()) {
        const jobId = `m_${crypto.randomUUID()}`;
        const job = {
          jobId,
          status: "processing",
          progress: 25,
          message: "Mock rendering in progress",
          outputUrl: null,
          sourceUrl: file.downloadUrl,
          createdAt: now,
          updatedAt: now,
        };
        mockJobs.set(jobId, job);
        const delay = Math.max(1_000, envNumber("MOCK_DELAY_MS", 5_000));
        setTimeout(() => {
          const current = mockJobs.get(jobId);
          if (!current) return;
          current.status = "completed";
          current.progress = 100;
          current.message = "Mock rendering completed; source file returned as test output";
          current.outputUrl = current.sourceUrl;
          current.updatedAt = new Date().toISOString();
        }, delay).unref();
        return res.status(202).json(publicJob(job));
      }

      const provider = await startWithProvider(file, params);
      const job = {
        jobId: encodeProviderJobId(provider.providerJobId),
        status: provider.status,
        progress: provider.progress,
        message: provider.message,
        outputUrl: provider.outputUrl,
        createdAt: now,
        updatedAt: now,
      };
      return res.status(202).json(publicJob(job));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/v1/remixes/:jobId", requireApiKey, async (req, res, next) => {
    try {
      if (req.params.jobId.startsWith("m_")) {
        const job = mockJobs.get(req.params.jobId);
        if (!job) return res.status(404).json({ error: "Unknown jobId" });
        return res.json(publicJob(job));
      }

      if (isMockMode()) return res.status(404).json({ error: "Unknown jobId" });
      const providerJobId = decodeProviderJobId(req.params.jobId);
      const provider = await getProviderStatus(providerJobId);
      const now = new Date().toISOString();
      return res.json(
        publicJob({
          jobId: req.params.jobId,
          status: provider.status,
          progress: provider.progress,
          message: provider.message,
          outputUrl: provider.outputUrl,
          updatedAt: now,
        }),
      );
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    const statusCode = Number(error.statusCode) || (error.name === "TimeoutError" ? 504 : 500);
    console.error(error);
    res.status(statusCode).json({
      error: statusCode >= 500 ? "Server error" : error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  });

  return app;
}

export function startServer() {
  const port = Number(process.env.PORT || 3000);
  const server = createApp().listen(port, "0.0.0.0", () => {
    console.log(`Remix Banger GPT Action listening on port ${port}`);
  });
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) startServer();
