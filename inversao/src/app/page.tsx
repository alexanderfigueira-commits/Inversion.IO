export default function Inicio() {
  return (
    <form className="space-y-8" aria-labelledby="titulo">
      <div className="space-y-2">
        <h1 id="titulo" className="text-3xl md:text-4xl">
          O que queres ver com mais clareza?
        </h1>
        <p className="text-soft">
          Cola um raciocínio, uma decisão, um post ou um argumento. A análise incide nas ideias,
          não em quem as escreveu.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="texto" className="font-display text-lg">
          O teu texto
        </label>
        <textarea
          id="texto"
          name="texto"
          rows={9}
          maxLength={4000}
          placeholder="Escreve ou cola aqui…"
          className="w-full resize-y rounded-lg border border-line bg-raised p-4 text-lg leading-relaxed placeholder:text-soft/70"
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="font-display text-lg">Como queres a resposta?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer gap-3 rounded-lg border border-line bg-raised p-4 has-[:checked]:border-ouro has-[:checked]:ring-1 has-[:checked]:ring-ouro">
            <input type="radio" name="modo" value="trilogico" defaultChecked className="mt-1.5 accent-[var(--ouro)]" />
            <span>
              <span className="block font-display">Trilógico</span>
              <span className="block text-base text-soft">Com o vocabulário do Keppe.</span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-3 rounded-lg border border-line bg-raised p-4 has-[:checked]:border-ouro has-[:checked]:ring-1 has-[:checked]:ring-ouro">
            <input type="radio" name="modo" value="simples" className="mt-1.5 accent-[var(--ouro)]" />
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
        <input type="checkbox" name="debate" className="size-6 shrink-0 accent-[var(--ouro)]" />
      </label>

      <button
        type="submit"
        className="min-h-12 w-full rounded-lg bg-ink px-6 py-3 font-display text-lg text-paper md:w-auto"
      >
        Analisar
      </button>
    </form>
  );
}
