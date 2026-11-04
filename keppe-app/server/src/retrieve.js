import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const STOP = new Set(
  (
    'a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sobre e ou mas que se ' +
    'como mais menos muito muita ja nao sim eu tu ele ela nos eles elas me te lhe meu minha teu tua seu sua ' +
    'isto isso aquilo ser estar ter haver fazer ao aos pelo pela'
  ).split(' '),
);

export function tokenize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

// Procura primeiro o corpus local (textos licenciados, nunca vai para o git) e depois o de demonstracao.
export function loadCorpus(dir = config.dataDir) {
  for (const name of ['corpus.local.json', 'corpus.json']) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) {
      const chunks = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { name, chunks };
    }
  }
  return { name: null, chunks: [] };
}

// BM25 simples, sem dependencias. Chega para um corpus de alguns livros.
export class Retriever {
  constructor(chunks) {
    this.chunks = chunks;
    this.docs = chunks.map((c) => tokenize(`${c.text} ${(c.tags || []).join(' ')}`));
    this.avg = this.docs.reduce((n, d) => n + d.length, 0) / (this.docs.length || 1);
    this.df = new Map();
    for (const d of this.docs) for (const t of new Set(d)) this.df.set(t, (this.df.get(t) || 0) + 1);
  }

  search(query, k = 4) {
    const q = tokenize(query);
    const N = this.docs.length;
    const k1 = 1.4;
    const b = 0.75;
    const scored = this.docs.map((doc, i) => {
      const tf = new Map();
      for (const t of doc) tf.set(t, (tf.get(t) || 0) + 1);
      let score = 0;
      for (const t of new Set(q)) {
        const f = tf.get(t);
        if (!f) continue;
        const n = this.df.get(t);
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / this.avg)));
      }
      return { i, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, k)
      .map((s) => this.chunks[s.i]);
  }
}
