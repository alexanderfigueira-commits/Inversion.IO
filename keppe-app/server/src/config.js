import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  root,
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  port: num(process.env.PORT, 8787),

  // Regras comerciais (tudo configuravel por variaveis de ambiente)
  freeSeconds: num(process.env.FREE_SECONDS, 10 * 60), // 10 min gratis
  weeklySeconds: num(process.env.WEEKLY_SECONDS, 30 * 60), // 30 min por semana (pago)
  priceEur: num(process.env.PRICE_EUR, 50),
  pricePeriod: process.env.PRICE_PERIOD || 'month', // 'week' | 'month'

  // IA
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.KEPPE_MODEL || 'claude-sonnet-5-5',

  // Editora (botao "Comprar")
  publisherName: process.env.PUBLISHER_NAME || 'Editora (a definir)',
  publisherUrl: process.env.PUBLISHER_URL || 'https://example.com/loja',

  // So para testes locais: permite simular subscricao sem a Apple
  devMode: process.env.DEV_MODE === '1',

  // Quanto tempo conta uma mensagem (aproximacao do tempo de conversa)
  firstMessageSeconds: 30,
  maxGapSeconds: 90,
};
