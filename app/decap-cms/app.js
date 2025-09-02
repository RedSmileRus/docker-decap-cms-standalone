// app/decap-cms/app.js
"use strict";

const express = require("express");
const path = require("path");
const url = require("url");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const csrf = require("csurf");
const cors = require("cors");

// --------- Settings ---------
const port = Number(process.env.PORT || 80);
const NODE_ENV = process.env.NODE_ENV || "production";

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

// Удобный эндпоинт, чтобы фронт мог получить токен (если появятся формы)
// Не обязателен — закомментируй, если не нужен.
// app.get("/csrf-token", (req, res) => {
//   try {
//     // создаст токен, если csurf активен на запросе
//     const token = req.csrfToken?.();
//     if (!token) return res.status(204).end();
//     res.json({ csrfToken: token });
//   } catch {
//     res.status(204).end();
//   }
// });

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

// --------- OAuth proxy routes ---------
const oauth_provider_app = require("../netlify-cms-github-oauth-provider/app.js");

app.use("/auth", (req, res, next) => {
  req.url = "/auth";
  oauth_provider_app(req, res, next);
});

app.use("/callback", (req, res, next) => {
  req.url = "/callback";
  oauth_provider_app(req, res, next);
});

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
  // Прочее
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// --------- Start ---------
app.listen(port, () => {
  console.log(`Decap CMS listening on port ${port}`);
});

// Для тестов/импорта
module.exports = app;
