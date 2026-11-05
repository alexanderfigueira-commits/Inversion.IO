import { config } from "./config";
import { embrulharTexto, montarSistema, type Bloco } from "./prompt";
import { criarSchemaAnalise, descreverProblemas, ErroApp, type Analise, type Pedido } from "./schema";

export type Mensagem = { role: "user" | "assistant"; content: string };

// Quem fala com o modelo (a API da Anthropic, ou o simulador nos testes).
export type ChamarModelo = (p: { sistema: Bloco[]; mensagens: Mensagem[]; maxTokens: number }) => Promise<string>;

// Aceita JSON puro, mas também tolera cercas de markdown ou uma frase antes e depois.
export function extrairJson(bruto: string): unknown {
  const limpo = bruto.replace(/```(?:json)?/gi, "");
  const ini = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (ini === -1 || fim <= ini) throw new Error("a resposta não contém um objeto JSON");
  try {
    return JSON.parse(limpo.slice(ini, fim + 1));
  } catch (e) {
    throw new Error(`JSON mal formado (${(e as Error).message})`);
  }
}

export async function analisar(
  pedido: Pedido,
  skill: string,
  chamar: ChamarModelo,
): Promise<{ analise: Analise; tentativas: number }> {
  const sistema = montarSistema(skill, pedido.modo, pedido.debate);
  const schema = criarSchemaAnalise(pedido.debate);
  const maxTokens = pedido.debate ? config.tokensComDebate() : config.tokensSemDebate();
  const mensagens: Mensagem[] = [{ role: "user", content: embrulharTexto(pedido.texto) }];

  let problema = "";
  // Uma tentativa e, se a resposta não vier no formato certo, mais uma.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const bruto = await chamar({ sistema, mensagens, maxTokens });
    try {
      const resultado = schema.safeParse(extrairJson(bruto));
      if (resultado.success) return { analise: resultado.data, tentativas: tentativa };
      problema = descreverProblemas(resultado.error);
    } catch (e) {
      problema = (e as Error).message;
    }
    console.error(`[analisar] tentativa ${tentativa} inválida: ${problema}`);
    mensagens.push(
      { role: "assistant", content: bruto.trim() || "(vazio)" },
      {
        role: "user",
        content:
          `A tua resposta anterior não cumpriu o formato. Problemas: ${problema}. ` +
          "Devolve de novo a análise completa, como um único objeto JSON válido e sem texto à volta.",
      },
    );
  }

  throw new ErroApp(
    502,
    "resposta_invalida",
    "Não consegui obter uma análise bem formada desta vez. Tenta outra vez dentro de instantes.",
  );
}
