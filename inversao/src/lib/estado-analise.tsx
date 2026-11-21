"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Entrada } from "./cliente";
import type { RespostaApi } from "./schema";

// Estado partilhado entre o ecrã Analisar e o ecrã Resultado.
// Guarda o rascunho (para não perder o texto ao mudar de ecrã) e a análise atual.
// A análise atual também vai para o sessionStorage, para sobreviver a um refresh.
// Na fase 4 o histórico passa para o IndexedDB; esta interface mantém-se.

export type AnaliseGuardada = { criadoEm: number; entrada: Entrada; resposta: RespostaApi };

type Contexto = {
  carregado: boolean;
  atual: AnaliseGuardada | null;
  definirAtual: (a: AnaliseGuardada) => void;
  rascunho: Entrada;
  definirRascunho: (parcial: Partial<Entrada>) => void;
  novaAnalise: () => void;
};

const CHAVE = "inversao:atual";
const RASCUNHO_INICIAL: Entrada = { texto: "", modo: "trilogico", debate: false };

const Ctx = createContext<Contexto | null>(null);

function lerGuardada(): AnaliseGuardada | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    if (!bruto) return null;
    const a = JSON.parse(bruto) as AnaliseGuardada;
    const ok = a && typeof a.criadoEm === "number" && typeof a.entrada?.texto === "string" && a.resposta && ("analise" in a.resposta || "cuidado" in a.resposta);
    return ok ? a : null;
  } catch {
    return null;
  }
}

export function AnaliseProvider({ children }: { children: ReactNode }) {
  const [atual, setAtual] = useState<AnaliseGuardada | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [rascunho, setRascunho] = useState<Entrada>(RASCUNHO_INICIAL);

  // O sessionStorage só existe no browser, por isso lê-se depois de a página montar.
  useEffect(() => {
    setAtual(lerGuardada());
    setCarregado(true);
  }, []);

  const definirAtual = useCallback((a: AnaliseGuardada) => {
    setAtual(a);
    try {
      sessionStorage.setItem(CHAVE, JSON.stringify(a));
    } catch {
      /* modo privado ou armazenamento cheio: a análise fica só em memória */
    }
  }, []);

  const definirRascunho = useCallback((parcial: Partial<Entrada>) => setRascunho((r) => ({ ...r, ...parcial })), []);

  const novaAnalise = useCallback(() => {
    setAtual(null);
    setRascunho((r) => ({ ...r, texto: "" }));
    try {
      sessionStorage.removeItem(CHAVE);
    } catch {
      /* ignora */
    }
  }, []);

  const valor = useMemo(
    () => ({ carregado, atual, definirAtual, rascunho, definirRascunho, novaAnalise }),
    [carregado, atual, definirAtual, rascunho, definirRascunho, novaAnalise],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAnalise(): Contexto {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAnalise tem de ser usado dentro de AnaliseProvider");
  return c;
}
