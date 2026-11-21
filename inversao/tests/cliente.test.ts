import { afterEach, describe, expect, it, vi } from "vitest";
import { ErroCliente, pedirAnalise } from "@/lib/cliente";
import { descreverEspera, paragrafos } from "@/lib/apresentacao";

const entrada = { texto: "olá", modo: "trilogico" as const, debate: false };
afterEach(() => vi.unstubAllGlobals());
const falso = (r: Response | Error) => vi.stubGlobal("fetch", vi.fn(async () => { if (r instanceof Error) throw r; return r; }));

describe("pedirAnalise", () => {
  it("envia o pedido em JSON para /api/analisar", async () => {
    const f = vi.fn(async () => Response.json({ analise: { x: 1 } }));
    vi.stubGlobal("fetch", f);
    await pedirAnalise(entrada);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/analisar");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(entrada);
  });

  it("devolve a análise e também o caso de cuidado", async () => {
    falso(Response.json({ analise: { x: 1 } }));
    expect(await pedirAnalise(entrada)).toEqual({ analise: { x: 1 } });
    falso(Response.json({ cuidado: { mensagem: "m" } }));
    expect(await pedirAnalise(entrada)).toEqual({ cuidado: { mensagem: "m" } });
  });

  it("mostra a mensagem do servidor num erro", async () => {
    falso(Response.json({ erro: { codigo: "texto_vazio", mensagem: "Escreve primeiro." } }, { status: 400 }));
    await expect(pedirAnalise(entrada)).rejects.toMatchObject({ message: "Escreve primeiro.", codigo: "texto_vazio" });
  });

  it("no limite de pedidos diz quando voltar", async () => {
    falso(Response.json({ erro: { codigo: "limite_pedidos", mensagem: "Muitas análises.", esperarSegundos: 1500 } }, { status: 429 }));
    const e = await pedirAnalise(entrada).catch((x) => x);
    expect(e).toBeInstanceOf(ErroCliente);
    expect(e.message).toBe("Muitas análises. Podes voltar daqui a cerca de 25 minutos.");
  });

  it("não rebenta com uma página de erro que não é JSON", async () => {
    falso(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(pedirAnalise(entrada)).rejects.toMatchObject({ message: "Algo correu mal. Tenta outra vez." });
  });

  it("sem ligação dá uma mensagem clara", async () => {
    falso(new TypeError("Failed to fetch"));
    await expect(pedirAnalise(entrada)).rejects.toMatchObject({ codigo: "sem_ligacao" });
  });

  it("deixa passar o cancelamento", async () => {
    const abort = new DOMException("x", "AbortError");
    falso(abort as unknown as Error);
    await expect(pedirAnalise(entrada)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("recusa um 200 com um corpo que não é uma análise", async () => {
    falso(Response.json({ qualquer: "coisa" }));
    await expect(pedirAnalise(entrada)).rejects.toMatchObject({ codigo: "resposta_ilegivel" });
  });
});

describe("apresentação", () => {
  it("descreve esperas", () => {
    expect(descreverEspera(30)).toBe("daqui a pouco");
    expect(descreverEspera(1500)).toBe("daqui a cerca de 25 minutos");
    expect(descreverEspera(2 * 3600)).toBe("daqui a cerca de 2 horas");
    expect(descreverEspera(3600)).toBe("daqui a cerca de 60 minutos");
  });
  it("parte em parágrafos", () => {
    expect(paragrafos("a\n\nb\n\n\n c ")).toEqual(["a", "b", "c"]);
  });
});
