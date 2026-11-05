import { extrairTexto } from "./prompt";
import type { ChamarModelo } from "./analisar";

// Simulador do modelo, só para desenvolvimento e testes (MOCK_IA=1, nunca em produção).
// Passa exatamente pelo mesmo caminho do modelo real: o JSON é validado e repetido se falhar.
//
// Gatilhos que podes escrever no texto para provocar situações:
//   [[invalido]]         a 1.ª tentativa vem estragada e a 2.ª sai bem (testa a repetição)
//   [[sempre-invalido]]  as duas tentativas vêm estragadas (testa o erro claro)
//   [[cerca]]            o JSON vem dentro de um bloco de markdown, com uma frase antes
//   [[sem-inversao]]     devolve "sem inversão relevante"

const AGENTES = ["PRUMO", "AXIOMA", "LÂMINA", "TRATOR", "NEXUS", "ESPELHO"];

export const mockModelo: ChamarModelo = async ({ sistema, mensagens }) => {
  const texto = extrairTexto(mensagens[0].content);
  const tentativa = mensagens.length > 1 ? 2 : 1;
  const comDebate = sistema.some((b) => b.texto.includes("## Debate (pedido)"));
  const simples = sistema.some((b) => b.texto.includes("Modo de linguagem: SIMPLES"));

  if (texto.includes("[[sempre-invalido]]")) return "isto não é json";
  if (texto.includes("[[invalido]]") && tentativa === 1) return '{"respostaDireta": "cortado a meio';

  const sem = texto.includes("[[sem-inversao]]");
  const decisao = /\b(devo|decidi|vou|decisão|decidir)\b/i.test(texto);
  const t = simples
    ? {
        raiz: "Está a impor a sua ideia em vez de ouvir o que a realidade pede.",
        mecanismo: "Corta exatamente onde devia investir, e chama a isso prudência.",
        essencia: "O seu maior trunfo já existe, só não está a ser aproveitado.",
        consciencia: "O problema talvez não seja o que falta, mas o que já tem e não usa.",
      }
    : {
        raiz: "Teomania na face da soberba: a vontade própria posta acima do que a realidade mostra.",
        mecanismo: "Inversão na ação: corta-se onde devia criar, e o valor é lido como custo.",
        essencia: "Há uma essência real, o ofício e a relação que já existem, bloqueada pela própria decisão.",
        consciencia: "Ver que o que se defende como prudência é uma recusa do bem que já está presente.",
      };

  const analise: Record<string, unknown> = {
    respostaDireta:
      "[Resposta simulada, sem IA] " +
      (sem
        ? "Este raciocínio está são no essencial e não vejo inversão relevante.\n\nO que faz bem é partir de dados reais e ouvir quem está do outro lado."
        : "A leitura mais honesta é que a decisão responde a um medo, e não ao que os factos pedem.\n\nSe a pessoa olhar para o que já tem, a decisão muda."),
    inversao: sem
      ? {
          raiz: "Não há inversão relevante neste material.",
          mecanismo: "O raciocínio liga causas e efeitos na ordem certa.",
          essenciaBloqueada: "O que está são: a escuta dos dados e a abertura à crítica.",
          tomarConsciencia: "Manter esta abertura é o que protege o raciocínio de se inverter.",
        }
      : { raiz: t.raiz, mecanismo: t.mecanismo, essenciaBloqueada: t.essencia, tomarConsciencia: t.consciencia },
    semInversaoRelevante: sem,
    sintese: [
      "Convergência: os agentes concordam que a decisão nasce de um pressuposto não examinado.",
      "Tensão: a LÂMINA vê soberba, o ESPELHO pergunta como vê quem está do outro lado.",
      "Fator decisivo: o que já existe e não está a ser usado.",
      "Insight de segunda ordem: a pressa serve para não ver.",
    ],
    escala: sem ? 4 : 2,
    escalaJustificacao: sem ? "Vê a realidade e age a partir do bem que tem." : "Sente a dor, mas atribui a causa ao sítio errado.",
  };
  if (decisao) analise.veredito = { decisao: sem ? "SEGUIR" : "SEGUIR COM CUIDADO", frase: "Segue, mas só depois de olhar para o que já tens." };
  if (comDebate) {
    analise.debate = AGENTES.map((agente) => ({
      agente,
      fala: `[Simulado] Posição de ${agente} depois do confronto com os outros agentes.`,
      sombra: `[Simulado] ${agente} verificou se não caiu na sua própria sombra e corrigiu.`,
    }));
  }

  const json = JSON.stringify(analise);
  return texto.includes("[[cerca]]") ? `Aqui está a análise:\n\`\`\`json\n${json}\n\`\`\`\nEspero que ajude.` : json;
};
