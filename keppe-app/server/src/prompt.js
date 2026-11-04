import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const CRISIS = /(suicid|me matar|matar-me|acabar com a minha vida|quero morrer|tirar a minha vida|auto.?mutila|me cortar)/i;

export function isCrisis(text) {
  return CRISIS.test(text);
}

export const CRISIS_REPLY =
  'Sinto muito que estejas a passar por isto, e agradeço teres partilhado. ' +
  'Neste momento o mais importante é falares com alguém de imediato. ' +
  'Em Portugal podes ligar para o 112 se estiveres em perigo, ou para a linha SNS 24 (808 24 24 24, opção 4) ' +
  'e para o SOS Voz Amiga (213 544 545), todos os dias. Se puderes, chama também alguém de confiança para ficar contigo. ' +
  'Esta app não substitui apoio profissional e não é adequada para uma situação de crise.';

function framework() {
  return fs.readFileSync(path.join(config.root, 'prompts', 'framework.md'), 'utf8');
}

export function buildSystem(passages) {
  const sources = passages.length
    ? passages
        .map((p, i) => `[${i + 1}] (${p.book}${p.page ? `, p. ${p.page}` : ''})\n${p.text}`)
        .join('\n\n')
    : '(nenhum excerto relevante foi encontrado para esta pergunta)';

  return `És um assistente de conversa que responde em português de Portugal, num tom caloroso, claro e direto,
como quem explica a um amigo inteligente. Respondes sempre através da lente descrita abaixo.

${framework()}

REGRAS OBRIGATÓRIAS
1. Não és o Norberto Keppe, não falas em nome dele nem finges ser ele. És uma ferramenta de estudo baseada na obra.
2. Citações: só podes citar texto que esteja nos EXCERTOS abaixo, copiado exatamente, e tens de marcar a origem
   com o número entre parênteses retos, por exemplo [1]. Nunca inventes citações, números de página ou títulos.
   Se nenhum excerto servir, responde sem citar e diz que é uma explicação tua.
3. Mantém as respostas curtas (até cerca de 150 palavras) porque a pessoa está a conversar, muitas vezes por voz.
4. Não és terapeuta nem médico. Não dês diagnósticos, nem digas a ninguém para parar medicação ou tratamento.
   Quando o tema for sofrimento sério, sugere falar com um profissional.
5. Se a pessoa falar em fazer mal a si própria ou a outros, pede que contacte o 112 ou a linha SNS 24 e não continues a análise.
6. Quando fizer sentido, no fim sugere o livro de onde vêm os excertos, sem insistir.

EXCERTOS
${sources}`;
}
