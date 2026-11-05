import { z } from "zod";

export const MODOS = ["trilogico", "simples"] as const;
export type Modo = (typeof MODOS)[number];

export const AGENTES = ["PRUMO", "AXIOMA", "LÂMINA", "TRATOR", "NEXUS", "ESPELHO"] as const;
export const DECISOES = ["SEGUIR", "SEGUIR COM CUIDADO", "REPENSAR", "NÃO SEGUIR"] as const;

// O que a app recebe do browser.
export const PedidoSchema = z.object({
  texto: z.string(),
  modo: z.enum(MODOS).default("trilogico"),
  debate: z.boolean().default(false),
});
export type Pedido = z.infer<typeof PedidoSchema>;

const texto = (max: number) => z.string().trim().min(1).max(max);

const InversaoSchema = z.object({
  raiz: texto(900),
  mecanismo: texto(1200),
  essenciaBloqueada: texto(1200),
  tomarConsciencia: texto(900),
});

const VereditoSchema = z.object({
  decisao: z.enum(DECISOES),
  frase: texto(600),
});

const FalaSchema = z.object({
  agente: z.enum(AGENTES),
  fala: texto(1500),
  sombra: texto(700),
});

// Debate: tem de ter os seis agentes, uma vez cada.
const DebateSchema = z
  .array(FalaSchema)
  .length(6)
  .refine((fs) => new Set(fs.map((f) => f.agente)).size === 6, {
    message: "o debate tem de ter os seis agentes, sem repetir nenhum",
  });

// O formato que o modelo tem de devolver. O debate só é exigido quando foi pedido,
// e quando não foi pedido é sempre descartado, mesmo que o modelo o envie.
export function criarSchemaAnalise(pedirDebate: boolean) {
  return z.object({
    respostaDireta: texto(4500),
    inversao: InversaoSchema,
    semInversaoRelevante: z.boolean(),
    sintese: z.array(texto(700)).min(4).max(6),
    escala: z.int().min(1).max(4),
    escalaJustificacao: texto(600),
    veredito: VereditoSchema.nullish().transform((v) => v ?? undefined),
    debate: pedirDebate
      ? DebateSchema
      : z
          .unknown()
          .optional()
          .transform(() => undefined),
  });
}

export type Analise = z.infer<ReturnType<typeof criarSchemaAnalise>>;

// Resposta quando a pessoa parece estar em sofrimento sério: sai do modo análise.
export type Cuidado = { mensagem: string };

export type RespostaApi =
  | { analise: Analise; meta: { modelo: string; tentativas: number } }
  | { cuidado: Cuidado };

export type CodigoErro =
  | "pedido_invalido"
  | "texto_vazio"
  | "texto_demasiado_longo"
  | "limite_pedidos"
  | "sem_chave"
  | "ia_indisponivel"
  | "resposta_invalida"
  | "erro_interno";

export class ErroApp extends Error {
  constructor(
    public status: number,
    public codigo: CodigoErro,
    mensagem: string,
    public extra?: Record<string, unknown>,
  ) {
    super(mensagem);
  }
}

export function descreverProblemas(erro: z.ZodError): string {
  return erro.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
    .join("; ");
}
