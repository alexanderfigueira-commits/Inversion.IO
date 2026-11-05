import "server-only";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "./config";

// A skill é lida no servidor, a partir de skill/SKILL.md e skill/references/.
// Para mudar o "cérebro" basta editar esses ficheiros, sem tocar no código.
// O conteúdo fica em cache e só é relido se os ficheiros mudarem.
// O caminho é dinâmico de propósito (permite SKILL_DIR), por isso o Next não o consegue seguir sozinho:
// a pasta skill/ é incluída no pacote de produção em next.config.ts (outputFileTracingIncludes).

type Cache = { chave: string; texto: string };
let cache: Cache | null = null;

const FICHEIROS = ["SKILL.md", path.join("references", "sinais-de-inversao.md")];

function semFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

export function lerSkill(pasta = config.pastaSkill()): string {
  const caminhos = FICHEIROS.map((f) => path.join(/*turbopackIgnore: true*/ pasta, f));
  const chave = caminhos.map((c) => `${c}:${statSync(/*turbopackIgnore: true*/ c).mtimeMs}`).join("|");
  if (cache?.chave === chave) return cache.texto;

  const [skill, referencia] = caminhos.map((c) => readFileSync(/*turbopackIgnore: true*/ c, "utf8"));
  const texto = `${semFrontmatter(skill)}\n\n---\n\n# Referência: sinais de inversão\n\n${semFrontmatter(referencia)}`;
  cache = { chave, texto };
  return texto;
}

export function limparCacheSkill() {
  cache = null;
}
