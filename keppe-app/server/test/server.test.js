import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsageStore, weekKey } from '../src/usage.js';
import { Retriever, loadCorpus, tokenize } from '../src/retrieve.js';
import { createApp } from '../src/server.js';
import { config } from '../src/config.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'keppe-')), 'usage.json');
const DEV = 'device-aaaaaaaaaaaaaaaa';

test('weekKey devolve a segunda feira da semana', () => {
  assert.equal(weekKey(Date.UTC(2026, 10, 4)), '2026-11-02'); // quarta 4 nov 2026
  assert.equal(weekKey(Date.UTC(2026, 10, 8, 23)), '2026-11-02'); // domingo
  assert.equal(weekKey(Date.UTC(2026, 10, 9)), '2026-11-09');
});

test('plano gratis acaba aos 10 minutos e nao repoe', () => {
  const u = new UsageStore(tmp());
  const t0 = Date.UTC(2026, 10, 4);
  assert.equal(u.status(DEV, t0).remainingSeconds, 600);
  u.consume(DEV, 600, t0);
  assert.equal(u.status(DEV, t0).locked, true);
  assert.equal(u.status(DEV, t0 + 30 * 86_400_000).locked, true);
});

test('plano pago tem 30 min por semana e repoe na segunda feira', () => {
  const u = new UsageStore(tmp());
  const wed = Date.UTC(2026, 10, 4);
  u.setPaid(DEV, wed + 31 * 86_400_000);
  assert.equal(u.status(DEV, wed).remainingSeconds, 1800);
  u.consume(DEV, 1800, wed);
  assert.equal(u.status(DEV, wed).locked, true);
  const nextMon = Date.UTC(2026, 10, 9, 1);
  assert.equal(u.status(DEV, nextMon).remainingSeconds, 1800);
});

test('cobranca por mensagem usa o intervalo com teto', () => {
  const u = new UsageStore(tmp());
  const t = Date.UTC(2026, 10, 4, 12);
  assert.equal(u.secondsFor(DEV, t), config.firstMessageSeconds);
  u.consume(DEV, 30, t);
  assert.equal(u.secondsFor(DEV, t + 20_000), 20);
  assert.equal(u.secondsFor(DEV, t + 5 * 60_000), config.maxGapSeconds);
  assert.equal(u.secondsFor(DEV, t + 3 * 3600_000), config.firstMessageSeconds);
});

test('pesquisa encontra o excerto certo, mesmo sem acentos', () => {
  const r = new Retriever(loadCorpus().chunks);
  assert.equal(r.search('o que e a inversão?')[0].id, 'demo-1');
  assert.equal(r.search('sintoma e saude')[0].id, 'demo-2');
  assert.deepEqual(r.search('xyzzy'), []);
  assert.ok(!tokenize('A inversão do ser').includes('do'));
});

async function withServer(opts, fn) {
  const server = createApp(opts);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, body, device = DEV) =>
    fetch(base + p, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-device-id': device },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    await fn(call);
  } finally {
    server.close();
  }
}

test('chat: so devolve citacoes marcadas e consome tempo', async () => {
  const generate = async () => 'A inversão põe o secundário à frente. [1]';
  await withServer({ usage: new UsageStore(tmp()), generate }, async (call) => {
    const r = await call('/api/chat', { message: 'o que é a inversão?' });
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.citations.length, 1);
    assert.equal(j.citations[0].n, 1);
    assert.ok(j.usage.usedSeconds > 0);
  });
});

test('chat: bloqueia com 402 depois do tempo gratis', async () => {
  const usage = new UsageStore(tmp());
  usage.consume(DEV, 600);
  await withServer({ usage, generate: async () => 'x' }, async (call) => {
    const r = await call('/api/chat', { message: 'olá' });
    const j = await r.json();
    assert.equal(r.status, 402);
    assert.equal(j.error, 'limit_reached');
    assert.equal(j.paywall.priceEur, 50);
  });
});

test('chat: crise devolve resposta segura sem chamar o modelo nem gastar tempo', async () => {
  let called = false;
  const generate = async () => ((called = true), 'x');
  await withServer({ usage: new UsageStore(tmp()), generate }, async (call) => {
    const r = await call('/api/chat', { message: 'quero me matar' });
    const j = await r.json();
    assert.equal(j.crisis, true);
    assert.match(j.reply, /112/);
    assert.equal(called, false);
    assert.equal(j.usage.usedSeconds, 0);
  });
});

test('api exige x-device-id valido e a subscricao real nao e simulada fora de DEV_MODE', async () => {
  await withServer({ usage: new UsageStore(tmp()) }, async (call) => {
    assert.equal((await call('/api/status', null, 'curto')).status, 400);
    assert.equal((await call('/api/subscription/verify', {})).status, 501);
  });
});
