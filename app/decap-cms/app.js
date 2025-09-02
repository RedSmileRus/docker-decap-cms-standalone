const express = require('express');
const path = require("path");
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const port = process.env.PORT ? Number(process.env.PORT) : 80;
const app = express();

// без паранойи, но полезно
app.use(helmet({
  contentSecurityPolicy: false, // UI подгружает скрипты/iframe, иначе много шуму
}));
app.disable('x-powered-by');
app.set('trust proxy', 1);

const limiter = rateLimit({ windowMs: 60 * 1000, limit: 600 });
app.use(limiter);

// статика
app.use(express.static('public'));

// decap bundle
app.get('/decap-cms.js', (req, res) => {
  res.sendFile('./dist/decap-cms.js', { root: __dirname });
});
app.get('/decap-cms.js.map', (req, res) => {
  res.sendFile('./dist/decap-cms.js.map', { root: __dirname });
});

// config.yml отдаем из корня репо выше
app.get('/config.yml', (req, res) => {
  res.sendFile('./config.yml', { root: path.join(__dirname, "..") });
});

// OAuth под тем же доменом
const oauth_provider_app = require('../netlify-cms-github-oauth-provider/app.js');
app.use('/auth', (req, res, next) => { req.url = '/auth'; oauth_provider_app(req, res, next) });
app.use('/callback', (req, res, next) => { req.url = '/callback'; oauth_provider_app(req, res, next) });

app.listen(port, () => {
  console.log(`Decap CMS listening on port ${port}`);
});
