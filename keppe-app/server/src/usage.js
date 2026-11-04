import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Inicio da semana (segunda feira 00:00 UTC) como chave, para repor o limite semanal.
export function weekKey(ts) {
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7; // segunda = 0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  return new Date(monday).toISOString().slice(0, 10);
}

export class UsageStore {
  constructor(file = path.join(config.dataDir, 'usage.json')) {
    this.file = file;
    this.data = {};
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* ficheiro novo */
    }
  }

  #rec(deviceId) {
    return (this.data[deviceId] ||= {
      freeUsed: 0,
      weekKey: null,
      weekUsed: 0,
      paidUntil: 0,
      lastMessageAt: 0,
    });
  }

  #save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    } catch (e) {
      console.error('Nao foi possivel gravar o uso:', e.message);
    }
  }

  status(deviceId, now = Date.now()) {
    const r = this.#rec(deviceId);
    const paid = r.paidUntil > now;
    if (paid && r.weekKey !== weekKey(now)) {
      r.weekKey = weekKey(now);
      r.weekUsed = 0;
    }
    const limit = paid ? config.weeklySeconds : config.freeSeconds;
    const used = paid ? r.weekUsed : r.freeUsed;
    const remaining = Math.max(0, limit - used);
    return {
      plan: paid ? 'paid' : 'free',
      limitSeconds: limit,
      usedSeconds: Math.min(used, limit),
      remainingSeconds: remaining,
      locked: remaining <= 0,
      paidUntil: paid ? r.paidUntil : null,
      // Para o plano gratis, o limite nao se repoe. Para o pago, repoe na segunda feira.
      resets: paid ? 'weekly' : 'never',
    };
  }

  // Segundos a cobrar por esta mensagem: tempo desde a anterior (com teto), ou um valor fixo na primeira.
  secondsFor(deviceId, now = Date.now()) {
    const r = this.#rec(deviceId);
    const gap = r.lastMessageAt ? (now - r.lastMessageAt) / 1000 : Infinity;
    if (gap > 15 * 60) return config.firstMessageSeconds;
    return Math.max(5, Math.min(config.maxGapSeconds, Math.round(gap)));
  }

  consume(deviceId, seconds, now = Date.now()) {
    const s = this.status(deviceId, now); // garante reposicao semanal
    const r = this.#rec(deviceId);
    if (s.plan === 'paid') r.weekUsed += seconds;
    else r.freeUsed += seconds;
    r.lastMessageAt = now;
    this.#save();
    return this.status(deviceId, now);
  }

  setPaid(deviceId, untilTs) {
    this.#rec(deviceId).paidUntil = untilTs;
    this.#save();
  }
}
