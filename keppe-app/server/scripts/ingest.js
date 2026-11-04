// Transforma os livros (ficheiros .txt) em excertos pesquisaveis.
//
// Coloca cada livro em data/books/NOME.txt com um cabecalho assim:
//   # livro: Titulo do livro
//   # autor: Nome
//   # url: https://loja-da-editora/livro
// E marca as paginas no texto com uma linha:  [p. 12]
//
// Resultado: data/corpus.local.json (ignorado pelo git, nunca publicar sem licenca).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';

const booksDir = path.join(config.dataDir, 'books');
const out = path.join(config.dataDir, 'corpus.local.json');
const TARGET = 700;

if (!fs.existsSync(booksDir)) {
  console.error(`Pasta em falta: ${booksDir}`);
  process.exit(1);
}

const chunks = [];
for (const file of fs.readdirSync(booksDir).filter((f) => f.endsWith('.txt'))) {
  const raw = fs.readFileSync(path.join(booksDir, file), 'utf8');
  const meta = {};
  const body = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^#\s*(livro|autor|url):\s*(.+)$/i);
    if (m && body.length === 0) meta[m[1].toLowerCase()] = m[2].trim();
    else body.push(line);
  }
  let page = null;
  let buf = '';
  let bufPage = null;
  const flush = () => {
    const text = buf.trim();
    if (text.length > 80) {
      chunks.push({
        id: `${path.basename(file, '.txt')}-${chunks.length}`,
        book: meta.livro || path.basename(file, '.txt'),
        author: meta.autor || '',
        page: bufPage,
        buyUrl: meta.url || config.publisherUrl,
        tags: [],
        text,
      });
    }
    buf = '';
    bufPage = null;
  };
  for (const para of body.join('\n').split(/\n{2,}/)) {
    const pm = para.match(/^\[p\.\s*(\d+)\]\s*$/);
    if (pm) {
      page = pm[1];
      continue;
    }
    const clean = para.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    if (bufPage === null) bufPage = page;
    buf += (buf ? ' ' : '') + clean;
    if (buf.length >= TARGET) flush();
  }
  flush();
  console.log(`${file}: ok`);
}

fs.writeFileSync(out, JSON.stringify(chunks, null, 1));
console.log(`${chunks.length} excertos gravados em ${out}`);
