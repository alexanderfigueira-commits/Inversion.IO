import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chamarAnthropic } from "@/lib/anthropic";
import { analisar } from "@/lib/analisar";
import { mockModelo } from "@/lib/mock";

const sistema = [{ texto: "ESTAVEL", cache: true }, { texto: "VARIAVEL" }];
const mensagens = [{ role: "user" as const, content: "olá" }];

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "chave-de-teste";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.MODELO_ANTHROPIC;
});

describe("pedido real à Anthropic (com fetch simulado)", () => {
  it("envia o modelo, a chave no cabeçalho e a cache só na parte estável", async () => {
    const fetchSim = vi.fn(async () => Response.json({ content: [{ type: "text", text: "{}" }] }));
    vi.stubGlobal("fetch", fetchSim);

    await chamarAnthropic({ sistema, mensagens, maxTokens: 123 });

    const [url, init] = fetchSim.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const h = init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("chave-de-teste");
    expect(h["anthropic-version"]).toBe("2023-06-01");
    const corpo = JSON.parse(init.body as string);
    expect(corpo.model).toBe("claude-sonnet-5-5");
    expect(corpo.max_tokens).toBe(123);
    expect(corpo.system[0]).toMatchObject({ type: "text", text: "ESTAVEL", cache_control: { type: "ephemeral" } });
    expect(corpo.system[1].cache_control).toBeUndefined();
    expect(corpo.messages).toEqual(mensagens);
    // a chave nunca vai no corpo
    expect(init.body as string).not.toContain("chave-de-teste");
  });

  it("o modelo pode ser mudado por variável de ambiente", async () => {
    process.env.MODELO_ANTHROPIC = "outro-modelo";
    const fetchSim = vi.fn(async () => Response.json({ content: [{ type: "text", text: "x" }] }));
    vi.stubGlobal("fetch", fetchSim);
    await chamarAnthropic({ sistema, mensagens, maxTokens: 10 });
    expect(JSON.parse((fetchSim.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).model).toBe("outro-modelo");
  });

  it("sem chave dá um erro claro e não faz nenhum pedido", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSim = vi.fn();
    vi.stubGlobal("fetch", fetchSim);
    await expect(chamarAnthropic({ sistema, mensagens, maxTokens: 10 })).rejects.toMatchObject({ status: 503, codigo: "sem_chave" });
    expect(fetchSim).not.toHaveBeenCalled();
  });

  it("não mostra ao utilizador o detalhe de um erro da API", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("detalhe interno secreto", { status: 529 })));
    const e = await chamarAnthropic({ sistema, mensagens, maxTokens: 10 }).catch((x) => x);
    expect(e).toMatchObject({ status: 503, codigo: "ia_indisponivel" });
    expect(e.message).not.toContain("secreto");
  });

  it("a resposta do modelo real passa pela mesma validação e repetição", async () => {
    const bom = await mockModelo({ sistema: [{ texto: "x" }], mensagens: [{ role: "user", content: "<texto_do_utilizador>\nolá\n</texto_do_utilizador>" }], maxTokens: 1 });
    const respostas = ["lixo", bom];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ content: [{ type: "text", text: respostas.shift() }] })));
    const r = await analisar({ texto: "olá", modo: "trilogico", debate: false }, "SKILL", chamarAnthropic);
    expect(r.tentativas).toBe(2);
  });
});
