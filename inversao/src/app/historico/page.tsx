export default function Historico() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl md:text-4xl">Histórico</h1>
      <div className="space-y-2">
        <label htmlFor="pesquisa" className="font-display text-lg">
          Pesquisar
        </label>
        <input
          id="pesquisa"
          type="search"
          placeholder="Procurar nas tuas análises…"
          className="min-h-12 w-full rounded-lg border border-line bg-raised px-4 text-lg placeholder:text-soft/70"
        />
      </div>
      <div className="rounded-lg border border-dashed border-line p-6 text-soft">
        <p>As análises que fizeres ficam guardadas só neste aparelho, e aparecem aqui.</p>
      </div>
    </div>
  );
}
