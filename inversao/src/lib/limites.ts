import { config } from "./config";

// Limites simples, em memória. Chegam para a primeira versão no Cloud Run com poucas instâncias.
// Cada instância tem a sua própria contagem, por isso o deploy limita o número de instâncias.
// Quando houver contas e subscrição, isto passa para uma base de dados.

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

const porIp = new Map<string, number[]>();
let global = { dia: "", n: 0 };

export type ResultadoLimite = { ok: true } | { ok: false; motivo: "hora" | "dia" | "global"; esperarSegundos: number };

function diaDe(agora: number) {
  return new Date(agora).toISOString().slice(0, 10);
}

export function verificarLimites(ip: string, agora = Date.now()): ResultadoLimite {
  // Limite global por dia: o teto máximo da fatura, aconteça o que acontecer.
  const dia = diaDe(agora);
  if (global.dia !== dia) global = { dia, n: 0 };
  if (global.n >= config.limiteGlobalDia()) {
    const amanha = new Date(agora);
    amanha.setUTCHours(24, 0, 0, 0);
    return { ok: false, motivo: "global", esperarSegundos: Math.ceil((amanha.getTime() - agora) / 1000) };
  }

  const marcas = (porIp.get(ip) ?? []).filter((t) => agora - t < DIA);
  const naHora = marcas.filter((t) => agora - t < HORA);

  if (naHora.length >= config.limiteHora()) {
    return { ok: false, motivo: "hora", esperarSegundos: Math.ceil((naHora[0] + HORA - agora) / 1000) };
  }
  if (marcas.length >= config.limiteDia()) {
    return { ok: false, motivo: "dia", esperarSegundos: Math.ceil((marcas[0] + DIA - agora) / 1000) };
  }

  marcas.push(agora);
  porIp.set(ip, marcas);
  global.n += 1;

  if (porIp.size > 5000) limparAntigos(agora);
  return { ok: true };
}

function limparAntigos(agora: number) {
  for (const [ip, marcas] of porIp) {
    if (marcas.every((t) => agora - t >= DIA)) porIp.delete(ip);
  }
}

// No Cloud Run o IP real do cliente é a ÚLTIMA entrada de x-forwarded-for (as anteriores
// podem ser inventadas pelo próprio cliente). Atrás de um balanceador de carga, ajustar.
export function ipDoPedido(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const partes = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (partes.length) return partes[partes.length - 1];
  }
  return headers.get("x-real-ip")?.trim() || "desconhecido";
}

export function reporLimites() {
  porIp.clear();
  global = { dia: "", n: 0 };
}
