// Toda a configuração vem de variáveis de ambiente, lida no momento do uso (e só no servidor).
const inteiro = (valor: string | undefined, porDefeito: number) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : porDefeito;
};

export const config = {
  modelo: () => process.env.MODELO_ANTHROPIC || "claude-sonnet-5-5",
  chaveAnthropic: () => process.env.ANTHROPIC_API_KEY || "",
  pastaSkill: () => process.env.SKILL_DIR || `${process.cwd()}/skill`,

  // Para controlar custos.
  maxCaracteres: () => inteiro(process.env.MAX_CARACTERES, 4000),
  limiteHora: () => inteiro(process.env.LIMITE_HORA, 10),
  limiteDia: () => inteiro(process.env.LIMITE_DIA, 30),
  limiteGlobalDia: () => inteiro(process.env.LIMITE_GLOBAL_DIA, 300),
  tokensSemDebate: () => inteiro(process.env.TOKENS_SEM_DEBATE, 3000),
  tokensComDebate: () => inteiro(process.env.TOKENS_COM_DEBATE, 5500),

  // Respostas simuladas, só para desenvolvimento. Nunca funciona em produção.
  simulado: () => process.env.MOCK_IA === "1" && process.env.NODE_ENV !== "production",
};
