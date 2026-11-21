// Textos e rótulos do ecrã Resultado. Sem dependências do servidor, para poder ir para o browser.
import type { Modo } from "./schema";

export const LIMITE_CARACTERES = 4000;

type Rotulos = { raiz: string; mecanismo: string; essenciaBloqueada: string; tomarConsciencia: string };

// No modo simples os rótulos também perdem o jargão, tal como a resposta.
export const ROTULOS_INVERSAO: Record<Modo, Rotulos> = {
  trilogico: {
    raiz: "Raiz",
    mecanismo: "Mecanismo",
    essenciaBloqueada: "Essência bloqueada",
    tomarConsciencia: "Tomar consciência",
  },
  simples: {
    raiz: "De onde vem",
    mecanismo: "Como se nota",
    essenciaBloqueada: "O que já joga a favor",
    tomarConsciencia: "O que vale a pena ver",
  },
};

// Quando não há inversão, os mesmos quatro campos passam a dizer o que está são.
export const ROTULOS_SEM_INVERSAO: Record<Modo, Rotulos> = {
  trilogico: { ...ROTULOS_INVERSAO.trilogico, essenciaBloqueada: "O que está são", tomarConsciencia: "Para manter" },
  simples: { ...ROTULOS_INVERSAO.simples, essenciaBloqueada: "O que está bem", tomarConsciencia: "Para manter" },
};

export const NIVEIS: Record<Modo, Record<1 | 2 | 3 | 4, string>> = {
  trilogico: {
    4: "Consciência e essência alinhadas",
    3: "Consciência emergente",
    2: "Inversão sentida, mal lida",
    1: "Inversão profunda e inconsciente",
  },
  simples: {
    4: "Vê a realidade e age a partir do que tem",
    3: "Começa a ver o que está a acontecer",
    2: "Sente o problema, mas põe a causa no sítio errado",
    1: "Age contra si próprio sem dar por isso",
  },
};

export const AGENTES_INFO: Record<string, string> = {
  PRUMO: "O diagnosticador",
  AXIOMA: "Os primeiros princípios",
  "LÂMINA": "O advogado do diabo",
  TRATOR: "O executor",
  NEXUS: "O sistémico",
  ESPELHO: "A realidade do outro",
};

export function paragrafos(texto: string): string[] {
  return texto
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function descreverEspera(segundos: number): string {
  if (segundos < 90) return "daqui a pouco";
  const min = Math.ceil(segundos / 60);
  if (min < 90) return `daqui a cerca de ${min} minutos`;
  const h = Math.ceil(min / 60);
  return `daqui a cerca de ${h} ${h === 1 ? "hora" : "horas"}`;
}
