import { beforeEach, describe, expect, it } from "vitest";
import { ipDoPedido, reporLimites, verificarLimites } from "@/lib/limites";
import { emCrise } from "@/lib/seguranca";

const T0 = Date.UTC(2026, 10, 5, 10, 0, 0);
const MIN = 60_000;

beforeEach(() => {
  reporLimites();
  process.env.LIMITE_HORA = "3";
  process.env.LIMITE_DIA = "5";
  process.env.LIMITE_GLOBAL_DIA = "100";
});

describe("limites por IP", () => {
  it("bloqueia ao fim do limite da hora e liberta passada a hora", () => {
    for (let i = 0; i < 3; i++) expect(verificarLimites("1.1.1.1", T0 + i * MIN).ok).toBe(true);
    const r = verificarLimites("1.1.1.1", T0 + 5 * MIN);
    expect(r).toMatchObject({ ok: false, motivo: "hora" });
    if (!r.ok) expect(r.esperarSegundos).toBe(55 * 60);
    expect(verificarLimites("1.1.1.1", T0 + 61 * MIN).ok).toBe(true);
  });

  it("conta cada IP à parte", () => {
    for (let i = 0; i < 3; i++) verificarLimites("1.1.1.1", T0);
    expect(verificarLimites("1.1.1.1", T0).ok).toBe(false);
    expect(verificarLimites("2.2.2.2", T0).ok).toBe(true);
  });

  it("aplica o limite do dia", () => {
    // 3 por hora, 5 por dia: 3 de manhã, 2 depois, e a 6.ª cai no limite do dia.
    for (let i = 0; i < 3; i++) verificarLimites("1.1.1.1", T0);
    for (let i = 0; i < 2; i++) verificarLimites("1.1.1.1", T0 + 90 * MIN);
    expect(verificarLimites("1.1.1.1", T0 + 180 * MIN)).toMatchObject({ ok: false, motivo: "dia" });
  });

  it("tem um teto global por dia", () => {
    process.env.LIMITE_GLOBAL_DIA = "2";
    verificarLimites("a", T0);
    verificarLimites("b", T0);
    expect(verificarLimites("c", T0)).toMatchObject({ ok: false, motivo: "global" });
    expect(verificarLimites("c", T0 + 24 * 60 * MIN).ok).toBe(true); // no dia seguinte
  });
});

describe("IP do pedido", () => {
  it("usa a última entrada de x-forwarded-for, que a Google acrescenta", () => {
    const h = new Headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" });
    expect(ipDoPedido(h)).toBe("203.0.113.7");
  });
  it("não deixa o cliente escolher o IP com um cabeçalho inventado", () => {
    expect(ipDoPedido(new Headers({ "x-forwarded-for": "falso, 203.0.113.7" }))).toBe("203.0.113.7");
  });
  it("tem um valor por defeito", () => {
    expect(ipDoPedido(new Headers())).toBe("desconhecido");
  });
});

describe("deteção de sofrimento sério", () => {
  it("apanha as formas mais comuns", () => {
    for (const t of ["quero me matar", "penso em suicídio", "não quero mais viver", "quero morrer"]) expect(emCrise(t)).toBe(true);
  });
  it("deixa passar texto normal", () => {
    expect(emCrise("Vou matar a concorrência com um preço mais baixo.")).toBe(false);
  });
});
