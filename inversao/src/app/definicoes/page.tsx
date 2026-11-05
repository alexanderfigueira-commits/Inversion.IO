export default function Definicoes() {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl md:text-4xl">Definições</h1>

      <fieldset className="space-y-3">
        <legend className="font-display text-lg">Modo por defeito</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-h-12 items-center gap-3 rounded-lg border border-line bg-raised px-4">
            <input type="radio" name="modoDefeito" value="trilogico" defaultChecked className="accent-[var(--ouro)]" />
            Trilógico
          </label>
          <label className="flex min-h-12 items-center gap-3 rounded-lg border border-line bg-raised px-4">
            <input type="radio" name="modoDefeito" value="simples" className="accent-[var(--ouro)]" />
            Linguagem simples
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-display text-lg">Tamanho da letra</legend>
        <div className="grid grid-cols-3 gap-3">
          {["Normal", "Grande", "Maior"].map((t, i) => (
            <label key={t} className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-line bg-raised px-3">
              <input type="radio" name="letra" value={t.toLowerCase()} defaultChecked={i === 0} className="accent-[var(--ouro)]" />
              {t}
            </label>
          ))}
        </div>
      </fieldset>

      <section className="space-y-3">
        <h2 className="text-xl">O teu histórico</h2>
        <p className="text-soft">As análises ficam guardadas apenas neste aparelho.</p>
        <button
          type="button"
          className="min-h-12 rounded-lg border border-barro px-5 py-2 text-barro"
        >
          Apagar o histórico
        </button>
      </section>

      <section className="space-y-2 rounded-lg bg-sunk p-5">
        <h2 className="text-xl">Sobre esta análise</h2>
        <p className="text-soft">
          A análise incide sobre ideias, raciocínios e textos. Não é um diagnóstico de pessoas e não
          substitui acompanhamento terapêutico.
        </p>
      </section>
    </div>
  );
}
