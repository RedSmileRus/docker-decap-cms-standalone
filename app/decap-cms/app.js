// app/decap-cms/app.js
"use strict";

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const csrf = require("csurf");
const cors = require("cors");
const { spawn } = require("child_process");
const proxy = require("express-http-proxy");

// --------- Settings ---------
const PORT = Number(process.env.PORT || 80);
const HOST = process.env.HOST || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || "production";
const OAUTH_PORT = Number(process.env.OAUTH_PORT || 8080);
const OAUTH_HOST = "127.0.0.1"; // слушаем только локально

// ORIGINS: "host1.com,foo.bar,baz.qux"
const ORIGINS = (process.env.ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// --------- App ---------
const app = express();

// Basic hardening
app.use(
  helmet({
    // CSP зачастую ломает SPA/CMS без явной настройки — выключим для простоты
    contentSecurityPolicy: false,
  })
);
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Rate limit (щадящий)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  })
);

// CORS (разрешаем только из ORIGINS; если список пуст — не добавляем CORS)
if (ORIGINS.length > 0) {
  const allowed = new Set(ORIGINS.map((h) => h.toLowerCase()));
  app.use(
    cors({
      origin(origin, callback) {
        // Разрешаем same-origin и пустой Origin (curl/health-check)
        if (!origin) return callback(null, true);
        try {
          const hostname = new URL(origin).hostname.toLowerCase();
          if (allowed.has(hostname)) return callback(null, true);
        } catch (_) {}
        return callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    })
  );
}

// Body & cookies
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// CSRF: включаем только на методы записи и НЕ на OAuth-роуты
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: NODE_ENV === "production",
  },
});
// Глобальная обёртка: применяем csurf точечно
app.use((req, res, next) => {
  const isWrite = /^(POST|PUT|PATCH|DELETE)$/i.test(req.method);
  const isOAuth = req.path.startsWith("/auth") || req.path.startsWith("/callback");
  if (isWrite && !isOAuth) return csrfProtection(req, res, next);
  return next();
});

// --------- Static & CMS bundle ---------
app.use(express.static(path.join(__dirname, "public")));

app.get("/decap-cms.js", (req, res) => {
  res.sendFile("./dist/decap-cms.js", { root: __dirname });
});

app.get("/decap-cms.js.map", (req, res) => {
  res.sendFile("./dist/decap-cms.js.map", { root: __dirname });
});

app.get("/config.yml", (req, res) => {
  res.sendFile("./config.yml", { root: path.join(__dirname, "..") });
});

// --------- OAuth: запускаем отдельный процесс и проксируем ---------
const oauthPath = path.join(__dirname, "..", "netlify-cms-github-oauth-provider", "app.js");

// Стартуем standalone-приложение OAuth на локальном порту OAUTH_PORT
const oauthProc = spawn("node", [oauthPath], {
  env: {
    ...process.env,
    PORT: String(OAUTH_PORT),
    HOST: OAUTH_HOST,
  },
  stdio: ["ignore", "inherit", "inherit"],
});

oauthProc.on("exit", (code, signal) => {
  console.error(`[oauth] process exited (code=${code}, signal=${signal})`);
});

const oauthTarget = `http://${OAUTH_HOST}:${OAUTH_PORT}`;

// Проксируем /auth и /callback на локальный OAuth-процесс
app.use(
  ["/auth", "/callback"],
  proxy(oauthTarget, {
    proxyReqPathResolver: (req) => req.originalUrl, // сохраняем путь как есть
    proxyErrorHandler: (err, res, next) => {
      console.error("[oauth proxy] error:", err.message);
      res.status(502).send("OAuth provider is not available");
    },
  })
);

// --------- Health ---------
app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

// --------- Errors ---------
app.use((err, req, res, next) => {
  // Отдельно обработаем CSRF
  if (err && err.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  // CORS ошибки — 403
  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Forbidden" });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// --------- Start ---------
const server = app
  .listen(PORT, HOST, () => {
    console.log(`Decap CMS listening on port ${PORT}`);
    console.log(`OAuth provider expected at ${oauthTarget}`);
  })
  .on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is in use. Set PORT env or free the port.`);
    }
    process.exit(1);
  });

// --------- Graceful shutdown ---------
function shutdown() {
  try {
    server && server.close(() => process.exit(0));
  } catch (_) {}
  if (oauthProc && !oauthProc.killed) {
    try {
      oauthProc.kill("SIGTERM");
    } catch (_) {}
  }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Для тестов/импорта
module.exports = app;
