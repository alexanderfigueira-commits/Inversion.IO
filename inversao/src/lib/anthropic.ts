import "server-only";
import { config } from "./config";
import { ErroApp } from "./schema";
import type { ChamarModelo } from "./analisar";

// Chamada direta à API de mensagens da Anthropic. A chave só existe no servidor.
export const chamarAnthropic: ChamarModelo = async ({ sistema, mensagens, maxTokens }) => {
  const chave = config.chaveAnthropic();
  if (!chave) {
    throw new ErroApp(503, "sem_chave", "A análise ainda não está ligada neste servidor.");
  }

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": chave,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.modelo(),
        max_tokens: maxTokens,
        // A parte estável (a skill) leva cache, para os pedidos seguintes ficarem mais baratos e rápidos.
        system: sistema.map((b) => ({
          type: "text",
          text: b.texto,
          ...(b.cache ? { cache_control: { type: "ephemeral" } } : {}),
        })),
        messages: mensagens,
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    throw new ErroApp(503, "ia_indisponivel", "Não consegui falar com o serviço de análise. Tenta outra vez dentro de instantes.");
  }

  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    console.error(`[anthropic] ${res.status}: ${detalhe.slice(0, 300)}`);
    if (res.status === 401 || res.status === 403) {
      throw new ErroApp(503, "sem_chave", "A análise ainda não está ligada neste servidor.");
    }
    throw new ErroApp(503, "ia_indisponivel", "O serviço de análise está ocupado. Tenta outra vez dentro de instantes.");
  }

  const dados = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (dados.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
};
