"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { AGENTES_INFO, NIVEIS, paragrafos, ROTULOS_INVERSAO, ROTULOS_SEM_INVERSAO } from "@/lib/apresentacao";
import { useAnalise } from "@/lib/estado-analise";
import type { Analise, Modo } from "@/lib/schema";

export function ResultadoAnalise() {
  const router = useRouter();
  const { carregado, atual, novaAnalise } = useAnalise();
  const titulo = useRef<HTMLHeadingElement>(null);

  // Ao chegar ao resultado, o foco vai para o título: o leitor de ecrã anuncia a mudança de página.
  useEffect(() => {
    if (carregado && atual) titulo.current?.focus({ preventScroll: true });
  }, [carregado, atual]);

  if (!carregado) {
    return (
      <p role="status" className="text-soft">
        A carregar…
      </p>
    );
  }

  if (!atual) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl md:text-4xl">Resultado</h1>
        <div className="space-y-4 rounded-lg border border-dashed border-line p-6 text-soft">
          <p>Ainda não há nenhuma análise. Escreve um texto no ecrã Analisar e o resultado aparece aqui.</p>
          <Link href="/" className="inline-flex min-h-12 items-center rounded-lg bg-ink px-5 font-display text-paper">
            Ir para Analisar
          </Link>
        </div>
      </div>
    );
  }

  const { entrada, resposta } = atual;

  function recomecar() {
    novaAnalise();
    router.push("/");
  }

  if ("cuidado" in resposta) {
    return (
      <div className="space-y-6">
        <h1 ref={titulo} tabIndex={-1} className="text-3xl outline-none md:text-4xl">
          Antes de mais
        </h1>
        <section className="space-y-4 rounded-lg border border-ambar bg-raised p-5" aria-label="Mensagem de cuidado">
          <p className="text-lg leading-relaxed">{resposta.cuidado.mensagem}</p>
        </section>
        <BotaoNova onClick={recomecar} />
      </div>
    );
  }

  const a = resposta.analise;
  const modo = entrada.modo;

  return (
    <article className="space-y-12">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-soft">
          {modo === "simples" ? "Linguagem simples" : "Modo trilógico"}
        </p>
        <h1 ref={titulo} tabIndex={-1} className="text-3xl outline-none md:text-4xl">
          Resposta direta
        </h1>
        <div className="space-y-4">
          {paragrafos(a.respostaDireta).map((p, i) => (
            <p key={i} className={i === 0 ? "text-xl leading-relaxed" : "leading-relaxed text-ink"}>
              {p}
            </p>
          ))}
        </div>
      </header>

      <CartaoInversao a={a} modo={modo} />
      <Sintese itens={a.sintese} />
      <Escala nivel={a.escala} justificacao={a.escalaJustificacao} modo={modo} />
      {a.veredito && <Veredito decisao={a.veredito.decisao} frase={a.veredito.frase} />}
      {a.debate && <Debate debate={a.debate} />}

      <section className="space-y-6 border-t border-line pt-8">
        <details className="rounded-lg border border-line bg-raised">
          <summary className="min-h-12 cursor-pointer px-4 py-3 font-display">O texto que analisaste</summary>
          <p className="whitespace-pre-wrap px-4 pb-4 text-soft">{entrada.texto}</p>
        </details>
        <p className="text-sm text-soft">A análise incide sobre ideias e textos. Não é um diagnóstico de pessoas.</p>
        <BotaoNova onClick={recomecar} />
      </section>
    </article>
  );
}

function BotaoNova({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-12 rounded-lg bg-ink px-6 py-3 font-display text-lg text-paper">
      Nova análise
    </button>
  );
}

function CartaoInversao({ a, modo }: { a: Analise; modo: Modo }) {
  const sem = a.semInversaoRelevante;
  const rotulos = (sem ? ROTULOS_SEM_INVERSAO : ROTULOS_INVERSAO)[modo];
  const partes = [
    ["raiz", a.inversao.raiz],
    ["mecanismo", a.inversao.mecanismo],
    ["essenciaBloqueada", a.inversao.essenciaBloqueada],
    ["tomarConsciencia", a.inversao.tomarConsciencia],
  ] as const;

  return (
    <section
      aria-labelledby="h-inversao"
      className={`space-y-5 rounded-lg border p-5 md:p-6 ${
        sem ? "border-azulado bg-raised" : "border-ambar bg-raised"
      }`}
    >
      <h2 id="h-inversao" className="text-2xl">
        {sem ? "Não encontrei inversão relevante" : "Onde está a inversão"}
      </h2>
      <dl className="space-y-5">
        {partes.map(([chave, texto]) => (
          <div key={chave} className="space-y-1">
            <dt
              className={`font-mono text-xs uppercase tracking-widest ${
                chave === "essenciaBloqueada" || chave === "tomarConsciencia" ? "text-azulado" : sem ? "text-soft" : "text-barro"
              }`}
            >
              {rotulos[chave]}
            </dt>
            <dd className="leading-relaxed">{texto}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Sintese({ itens }: { itens: string[] }) {
  return (
    <section aria-labelledby="h-sintese" className="space-y-4">
      <h2 id="h-sintese" className="text-2xl">
        Síntese do conselho
      </h2>
      <ul className="space-y-3">
        {itens.map((item, i) => (
          <li key={i} className="flex gap-3 leading-relaxed">
            <span aria-hidden className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-ouro" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Medidor vertical: o 4 em cima e o 1 em baixo. Os níveis até ao atual ficam preenchidos.
function Escala({ nivel, justificacao, modo }: { nivel: number; justificacao: string; modo: Modo }) {
  const n = Math.min(4, Math.max(1, Math.round(nivel))) as 1 | 2 | 3 | 4;
  const niveis = [4, 3, 2, 1] as const;
  return (
    <section aria-labelledby="h-escala" className="space-y-4">
      <h2 id="h-escala" className="text-2xl">
        Escala de consciência
      </h2>
      <div className="flex gap-5">
        <div
          role="meter"
          aria-label="Escala de consciência"
          aria-valuemin={1}
          aria-valuemax={4}
          aria-valuenow={n}
          aria-valuetext={`Nível ${n} de 4: ${NIVEIS[modo][n]}`}
          className="flex shrink-0 flex-col gap-1"
        >
          {niveis.map((x) => (
            <span
              key={x}
              aria-hidden
              className={`block h-12 w-4 rounded-sm border ${x <= n ? "border-ouro bg-ouro" : "border-line bg-sunk"} ${x === n ? "ring-2 ring-ink ring-offset-2 ring-offset-paper" : ""}`}
            />
          ))}
        </div>
        <ol className="flex flex-col gap-1" aria-hidden>
          {niveis.map((x) => (
            <li key={x} className={`flex h-12 items-center gap-3 ${x === n ? "font-semibold text-ink" : "text-soft"}`}>
              <span className="font-mono text-sm">{x}</span>
              <span className="leading-snug">{NIVEIS[modo][x]}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="leading-relaxed text-soft">{justificacao}</p>
    </section>
  );
}

const ESTILO_VEREDITO: Record<string, string> = {
  SEGUIR: "border-azulado text-azulado",
  "SEGUIR COM CUIDADO": "border-ambar text-ambar",
  REPENSAR: "border-barro text-barro",
  "NÃO SEGUIR": "border-barro bg-barro text-paper",
};

function Veredito({ decisao, frase }: { decisao: string; frase: string }) {
  return (
    <section aria-labelledby="h-veredito" className="space-y-3">
      <h2 id="h-veredito" className="text-2xl">
        Veredito
      </h2>
      <p className={`inline-block rounded border-2 px-3 py-1.5 font-mono text-sm font-medium tracking-wide ${ESTILO_VEREDITO[decisao] ?? "border-line"}`}>
        {decisao}
      </p>
      <p className="leading-relaxed">{frase}</p>
    </section>
  );
}

function Debate({ debate }: { debate: NonNullable<Analise["debate"]> }) {
  return (
    <details className="group rounded-lg border border-line bg-raised">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 font-display text-lg [&::-webkit-details-marker]:hidden">
        Debate dos seis agentes
        <span aria-hidden className="text-soft transition-transform group-open:rotate-90 motion-reduce:transition-none">
          ▸
        </span>
      </summary>
      <div className="space-y-6 border-t border-line px-4 py-5">
        {debate.map((f) => (
          <div key={f.agente} className="space-y-2">
            <h3 className="flex flex-wrap items-baseline gap-x-3 text-base">
              <span className="font-mono text-sm tracking-widest">{f.agente}</span>
              <span className="font-body text-soft">{AGENTES_INFO[f.agente]}</span>
            </h3>
            <p className="leading-relaxed">{f.fala}</p>
            <p className="text-base leading-relaxed text-soft">
              <span className="font-mono text-xs uppercase tracking-widest">Verificação de sombra </span>
              {f.sombra}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}
