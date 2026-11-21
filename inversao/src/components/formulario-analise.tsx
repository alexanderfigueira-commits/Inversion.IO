"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ErroCliente, pedirAnalise } from "@/lib/cliente";
import { LIMITE_CARACTERES } from "@/lib/apresentacao";
import { useAnalise } from "@/lib/estado-analise";

const TEMPO_MAXIMO_MS = 75_000;

export function FormularioAnalise() {
  const router = useRouter();
  const { rascunho, definirRascunho, definirAtual } = useAnalise();
  const [aAnalisar, setAAnalisar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campoTexto = useRef<HTMLTextAreaElement>(null);
  const controlador = useRef<AbortController | null>(null);
  const motivoCancelamento = useRef<"pessoa" | "tempo" | null>(null);

  const tamanho = rascunho.texto.trim().length;
  const excesso = tamanho - LIMITE_CARACTERES;

  async function submeter(e?: FormEvent) {
    e?.preventDefault();
    if (aAnalisar) return;

    const texto = rascunho.texto.trim();
    if (!texto) {
      setErro("Escreve ou cola primeiro o texto que queres analisar.");
      campoTexto.current?.focus();
      return;
    }
    if (texto.length > LIMITE_CARACTERES) {
      setErro(`O texto tem ${excesso} caracteres a mais. O máximo são ${LIMITE_CARACTERES}.`);
      campoTexto.current?.focus();
      return;
    }

    setErro(null);
    setAAnalisar(true);
    motivoCancelamento.current = null;
    const ctrl = new AbortController();
    controlador.current = ctrl;
    const relogio = setTimeout(() => {
      motivoCancelamento.current = "tempo";
      ctrl.abort();
    }, TEMPO_MAXIMO_MS);

    try {
      const entrada = { texto, modo: rascunho.modo, debate: rascunho.debate };
      const resposta = await pedirAnalise(entrada, ctrl.signal);
      definirAtual({ criadoEm: Date.now(), entrada, resposta });
      router.push("/resultado");
      // Mantém o estado "a analisar" até a página mudar, para o botão não voltar a ficar ativo.
    } catch (e) {
      setAAnalisar(false);
      if ((e as Error).name === "AbortError") {
        if (motivoCancelamento.current === "tempo") {
          setErro("A análise demorou mais do que o esperado. Tenta outra vez, talvez com um texto mais curto.");
        }
        // Se foi a pessoa a cancelar, não há nada a dizer.
      } else if (e instanceof ErroCliente) {
        setErro(e.message);
      } else {
        setErro("Algo correu mal. Tenta outra vez.");
      }
    } finally {
      clearTimeout(relogio);
    }
  }

  function cancelar() {
    motivoCancelamento.current = "pessoa";
    controlador.current?.abort();
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl ou Cmd mais Enter envia, como em muitas aplicações de escrita.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submeter();
    }
  }

  return (
    <form className="space-y-8" aria-labelledby="titulo" onSubmit={submeter} noValidate>
      <div className="space-y-2">
        <h1 id="titulo" className="text-3xl md:text-4xl">
          O que queres ver com mais clareza?
        </h1>
        <p className="text-soft">
          Cola um raciocínio, uma decisão, um post ou um argumento. A análise incide nas ideias, não em quem as escreveu.
        </p>
      </div>

      <fieldset disabled={aAnalisar} className="space-y-8 disabled:opacity-60">
        <div className="space-y-2">
          <label htmlFor="texto" className="font-display text-lg">
            O teu texto
          </label>
          <textarea
            ref={campoTexto}
            id="texto"
            name="texto"
            rows={9}
            value={rascunho.texto}
            onChange={(e) => definirRascunho({ texto: e.target.value })}
            onKeyDown={aoTeclar}
            placeholder="Escreve ou cola aqui…"
            aria-describedby="contador"
            aria-invalid={excesso > 0 || undefined}
            className="w-full resize-y rounded-lg border border-line bg-raised p-4 text-lg leading-relaxed placeholder:text-soft/70"
          />
          <p id="contador" className={`text-sm ${excesso > 0 ? "text-barro" : "text-soft"}`}>
            {excesso > 0
              ? `${excesso} caracteres a mais (máximo ${LIMITE_CARACTERES})`
              : `${tamanho} de ${LIMITE_CARACTERES} caracteres`}
          </p>
        </div>

        <fieldset className="space-y-3">
          <legend className="font-display text-lg">Como queres a resposta?</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer gap-3 rounded-lg border border-line bg-raised p-4 has-[:checked]:border-ouro has-[:checked]:ring-1 has-[:checked]:ring-ouro">
              <input
                type="radio"
                name="modo"
                value="trilogico"
                checked={rascunho.modo === "trilogico"}
                onChange={() => definirRascunho({ modo: "trilogico" })}
                className="mt-1.5 accent-[var(--ouro)]"
              />
              <span>
                <span className="block font-display">Trilógico</span>
                <span className="block text-base text-soft">Com o vocabulário do Keppe.</span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-lg border border-line bg-raised p-4 has-[:checked]:border-ouro has-[:checked]:ring-1 has-[:checked]:ring-ouro">
              <input
                type="radio"
                name="modo"
                value="simples"
                checked={rascunho.modo === "simples"}
                onChange={() => definirRascunho({ modo: "simples" })}
                className="mt-1.5 accent-[var(--ouro)]"
              />
              <span>
                <span className="block font-display">Linguagem simples</span>
                <span className="block text-base text-soft">Sem jargão, como numa conversa.</span>
              </span>
            </label>
          </div>
        </fieldset>

        <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
          <span>
            <span className="block font-display">Mostrar o debate dos agentes</span>
            <span className="block text-base text-soft">Vê como os seis pontos de vista discutiram.</span>
          </span>
          <input
            type="checkbox"
            name="debate"
            checked={rascunho.debate}
            onChange={(e) => definirRascunho({ debate: e.target.checked })}
            className="size-6 shrink-0 accent-[var(--ouro)]"
          />
        </label>
      </fieldset>

      {erro && (
        <p role="alert" className="rounded-lg border border-barro bg-raised px-4 py-3 text-barro">
          {erro}
        </p>
      )}

      {aAnalisar ? (
        <div className="flex flex-wrap items-center gap-4">
          <p role="status" className="flex items-center gap-3 text-soft">
            <span aria-hidden className="size-3 rounded-full bg-ouro motion-safe:animate-pulse" />A analisar. Isto pode demorar um pouco.
          </p>
          <button type="button" onClick={cancelar} className="min-h-12 rounded-lg border border-line px-5 py-2 text-soft hover:text-ink">
            Cancelar
          </button>
        </div>
      ) : (
        <button type="submit" className="min-h-12 w-full rounded-lg bg-ink px-6 py-3 font-display text-lg text-paper md:w-auto">
          Analisar
        </button>
      )}
    </form>
  );
}
