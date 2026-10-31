'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { cacarLicencasPorCNPJ, validarCNPJ } = require('./scraper');
const { MUNICIPIOS, consultarOrgaoMunicipal, IAT_SOURCE } = require('./src/data/municipios-parana');

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || '10kb';
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 30;

app.disable('x-powered-by');
app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Requests sem Origin (ex.: servidor-servidor/health check) são permitidas.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origem não autorizada pelo CORS.'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));

app.use(express.json({ limit: MAX_BODY_SIZE, strict: true }));

// Limitação simples por IP. Em múltiplas instâncias, substitua por Redis/armazenamento compartilhado.
const requestsByIp = new Map();
app.use('/api/', (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  let entry = requestsByIp.get(ip);

  if (!entry || now - entry.startedAt >= RATE_LIMIT_WINDOW_MS) {
    entry = { startedAt: now, count: 0 };
  }

  entry.count += 1;
  requestsByIp.set(ip, entry);

  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      sucesso: false,
      erro: 'Limite de consultas excedido. Tente novamente mais tarde.',
    });
  }

  // Limpa entradas antigas sem criar timer permanente.
  if (requestsByIp.size > 1000) {
    for (const [key, value] of requestsByIp.entries()) {
      if (now - value.startedAt >= RATE_LIMIT_WINDOW_MS) requestsByIp.delete(key);
    }
  }
  return next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ecolacqua-backend' });
});

app.get('/api/orgaos/parana', (req, res) => {
  const municipio = typeof req.query.municipio === 'string' ? req.query.municipio : '';
  if (municipio) return res.json({ sucesso: true, competencia: consultarOrgaoMunicipal(municipio), fonte: IAT_SOURCE });
  return res.json({ sucesso: true, total: MUNICIPIOS.length, municipios: MUNICIPIOS, fonte: IAT_SOURCE, aviso: 'Certificação/delegação pode ser parcial. Consulte a resolução e o plano de trabalho para a atividade específica.' });
});

app.post('/api/cacar-licencas', async (req, res, next) => {
  const cnpj = typeof req.body?.cnpj === 'string' ? req.body.cnpj : '';
  const municipio = typeof req.body?.municipio === 'string' ? req.body.municipio : '';

  if (!cnpj) {
    return res.status(400).json({ sucesso: false, erro: 'CNPJ não informado.' });
  }

  if (!validarCNPJ(cnpj)) {
    return res.status(400).json({ sucesso: false, erro: 'CNPJ inválido. Informe um CNPJ com 14 dígitos verificáveis.' });
  }

  try {
    const resultado = await cacarLicencasPorCNPJ(cnpj, municipio);
    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ sucesso: false, erro: 'Rota não encontrada.' });
});

app.use((error, _req, res, _next) => {
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ sucesso: false, erro: 'Corpo da requisição excede o limite permitido.' });
  }
  if (error.message === 'Origem não autorizada pelo CORS.') {
    return res.status(403).json({ sucesso: false, erro: 'Origem não autorizada.' });
  }
  if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, 'body')) {
    return res.status(400).json({ sucesso: false, erro: 'JSON inválido.' });
  }

  console.error('Erro interno:', error.message);
  return res.status(500).json({ sucesso: false, erro: 'Erro interno no servidor.' });
});

app.listen(PORT, () => {
  console.log(`ECOLACQUA backend ativo na porta ${PORT}`);
});
