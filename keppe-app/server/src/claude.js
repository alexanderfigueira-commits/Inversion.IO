import { config } from './config.js';

// Chama a API da Anthropic. Sem chave, devolve uma resposta de demonstracao
// montada a partir do melhor excerto, para o prototipo poder ser testado sem custos.
export async function generateReply({ system, messages, passages }) {
  if (!config.apiKey) return demoReply(passages);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: config.model, max_tokens: 600, system, messages }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

function demoReply(passages) {
  if (!passages.length) {
    return '(modo demonstração, sem chave de IA) Não encontrei um excerto sobre isso. Com a IA ligada, eu explicaria na lente da Trilogia Analítica.';
  }
  const p = passages[0];
  return `(modo demonstração, sem chave de IA) O excerto mais próximo da tua pergunta diz: "${p.text}" [1]`;
}
