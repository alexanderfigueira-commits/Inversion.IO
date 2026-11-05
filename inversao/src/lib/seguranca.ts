import type { Cuidado } from "./schema";

// A skill manda sair do modo análise perante sofrimento sério e cuidar da pessoa.
// Esta verificação é grosseira de propósito: prefere avisar a mais do que a menos.
// O texto é comparado sem acentos, para "suicídio" e "suicidio" serem apanhados da mesma forma.
const CRISE =
  /(suicid|me matar|matar-me|acabar com a minha vida|quero morrer|tirar a minha vida|auto.?mutila|me cortar|nao quero (mais )?viver)/;

const semAcentos = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function emCrise(texto: string): boolean {
  return CRISE.test(semAcentos(texto));
}

export const CUIDADO: Cuidado = {
  mensagem:
    "Antes de qualquer análise, uma coisa mais importante: se estás a pensar em fazer mal a ti próprio, " +
    "fala já com alguém. Em Portugal podes ligar para o 112 se estiveres em perigo, ou para a linha SNS 24 " +
    "(808 24 24 24, opção 4) e para o SOS Voz Amiga (213 544 545). Se puderes, chama também alguém de confiança " +
    "para ficar contigo. Esta aplicação analisa ideias e textos. Não substitui apoio profissional e não é " +
    "o lugar certo para uma situação destas.",
};
