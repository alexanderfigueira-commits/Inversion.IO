import type { Modo, RespostaApi } from "./schema";
import { descreverEspera } from "./apresentacao";

export type Entrada = { texto: string; modo: Modo; debate: boolean };

// Um erro com uma mensagem já pronta para mostrar à pessoa.
export class ErroCliente extends Error {
  constructor(
    mensagem: string,
    public codigo?: string,
  ) {
    super(mensagem);
  }
}

export async function pedirAnalise(entrada: Entrada, sinal?: AbortSignal): Promise<RespostaApi> {
  let res: Response;
  try {
    res = await fetch("/api/analisar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entrada),
      signal: sinal,
    });
  } catch (e) {
    // Cancelamentos (botão Cancelar ou tempo esgotado) são tratados por quem chamou.
    if ((e as Error).name === "AbortError") throw e;
    throw new ErroCliente("Não consegui ligar ao servidor. Verifica a ligação e tenta outra vez.", "sem_ligacao");
  }

  let corpo: unknown = null;
  try {
    corpo = await res.json();
  } catch {
    /* resposta que não é JSON, por exemplo uma página de erro de um intermediário */
  }

  if (!res.ok) {
    const erro = (corpo as { erro?: { mensagem?: unknown; codigo?: unknown; esperarSegundos?: unknown } } | null)?.erro;
    let mensagem = typeof erro?.mensagem === "string" ? erro.mensagem : "Algo correu mal. Tenta outra vez.";
    if (res.status === 429 && typeof erro?.esperarSegundos === "number") {
      mensagem += ` Podes voltar ${descreverEspera(erro.esperarSegundos)}.`;
    }
    throw new ErroCliente(mensagem, typeof erro?.codigo === "string" ? erro.codigo : undefined);
  }

  if (!corpo || typeof corpo !== "object" || !("analise" in corpo || "cuidado" in corpo)) {
    throw new ErroCliente("Recebi uma resposta que não consegui ler. Tenta outra vez.", "resposta_ilegivel");
  }
  return corpo as RespostaApi;
}
