// Ponto de ligação para contas e subscrição. NÃO está implementado nesta versão.
//
// Hoje toda a gente é anónima e o limite é por IP. Quando houver contas (e a subscrição de
// 9,99 € por mês com o Stripe), é aqui que se muda:
//   1. obterAcesso() lê a sessão do pedido e devolve o utilizador e o plano;
//   2. um webhook do Stripe atualiza o plano do utilizador;
//   3. a rota /api/analisar já usa o resultado para escolher a chave do limite
//      (o utilizador em vez do IP) e, mais tarde, limites diferentes por plano.
// A rota e o resto do código não precisam de mudar.

export type Plano = "anonimo" | "subscritor";

export type Acesso = {
  utilizadorId: string | null;
  plano: Plano;
};

export async function obterAcesso(_pedido: Request): Promise<Acesso> {
  return { utilizadorId: null, plano: "anonimo" };
}
