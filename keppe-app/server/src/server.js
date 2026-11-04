import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { UsageStore } from './usage.js';
import { Retriever, loadCorpus } from './retrieve.js';
import { buildSystem, isCrisis, CRISIS_REPLY } from './prompt.js';
import { generateReply } from './claude.js';

const DEVICE = /^[A-Za-z0-9-]{16,64}$/;
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const paywall = () => ({
  priceEur: config.priceEur,
  period: config.pricePeriod,
  weeklyMinutes: Math.round(config.weeklySeconds / 60),
  freeMinutes: Math.round(config.freeSeconds / 60),
});

const publisher = () => ({ name: config.publisherName, url: config.publisherUrl });

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 32 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Pedido demasiado grande'), { code: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('JSON invalido'), { code: 400 });
  }
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

export function createApp({ usage = new UsageStore(), generate = generateReply, corpus = loadCorpus() } = {}) {
  const retriever = new Retriever(corpus.chunks);

  async function chat(req, res, deviceId) {
    const body = await readJson(req);
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1000) : '';
    if (!message) return send(res, 400, { error: 'Mensagem vazia' });

    const now = Date.now();
    const before = usage.status(deviceId, now);
    if (before.locked) return send(res, 402, { error: 'limit_reached', usage: before, paywall: paywall(), publisher: publisher() });

    // Situacoes de crise: resposta fixa e segura, sem consumir tempo e sem passar pelo modelo.
    if (isCrisis(message)) return send(res, 200, { reply: CRISIS_REPLY, citations: [], crisis: true, usage: before });

    const passages = retriever.search(message, 4);
    const history = cleanHistory(body.history);
    const reply = await generate({
      system: buildSystem(passages),
      messages: [...history, { role: 'user', content: message }],
      passages,
    });

    // So devolvemos como citacao os excertos que a resposta de facto marcou com [n].
    const used = new Set([...reply.matchAll(/\[(\d)\]/g)].map((m) => Number(m[1])));
    const citations = passages
      .map((p, i) => ({ n: i + 1, book: p.book, page: p.page || null, excerpt: p.text, buyUrl: p.buyUrl || config.publisherUrl }))
      .filter((c) => used.has(c.n));

    const after = usage.consume(deviceId, usage.secondsFor(deviceId, now), now);
    send(res, 200, { reply, citations, usage: after, publisher: publisher() });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(publicDir, 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, corpus: corpus.name, passages: corpus.chunks.length, ai: Boolean(config.apiKey) });
    }

    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Nao encontrado' });

    const deviceId = req.headers['x-device-id'];
    if (typeof deviceId !== 'string' || !DEVICE.test(deviceId)) return send(res, 400, { error: 'x-device-id em falta ou invalido' });

    if (req.method === 'GET' && url.pathname === '/api/status') {
      return send(res, 200, { usage: usage.status(deviceId), paywall: paywall(), publisher: publisher() });
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') return chat(req, res, deviceId);

    // A verificacao real do recibo da Apple (JWS) ainda nao esta feita. Ver README.
    if (req.method === 'POST' && url.pathname === '/api/subscription/verify') {
      if (!config.devMode) return send(res, 501, { error: 'Verificacao de compra da Apple ainda por implementar' });
      const days = config.pricePeriod === 'week' ? 7 : 31;
      usage.setPaid(deviceId, Date.now() + days * 86_400_000);
      return send(res, 200, { usage: usage.status(deviceId) });
    }

    return send(res, 404, { error: 'Nao encontrado' });
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!e.code || typeof e.code !== 'number') console.error(e);
      send(res, typeof e.code === 'number' ? e.code : 500, { error: typeof e.code === 'number' ? e.message : 'Erro interno' });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApp().listen(config.port, () => {
    console.log(`Servidor em http://localhost:${config.port}  (IA: ${config.apiKey ? 'ligada' : 'modo demonstracao'}, dev: ${config.devMode})`);
  });
}
