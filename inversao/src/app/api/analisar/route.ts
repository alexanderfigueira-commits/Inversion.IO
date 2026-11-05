import { obterAcesso } from "@/lib/acesso";
import { analisar, type ChamarModelo } from "@/lib/analisar";
import { chamarAnthropic } from "@/lib/anthropic";
import { config } from "@/lib/config";
import { ipDoPedido, verificarLimites } from "@/lib/limites";
import { mockModelo } from "@/lib/mock";
import { CUIDADO, emCrise } from "@/lib/seguranca";
import { ErroApp, PedidoSchema, type RespostaApi } from "@/lib/schema";
import { lerSkill } from "@/lib/skill";

const CABECALHOS = { "Cache-Control": "no-store" };

function json(corpo: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(corpo, { status, headers: { ...CABECALHOS, ...extra } });
}

function erro(e: ErroApp) {
  const extra: Record<string, string> = {};
  if (e.extra?.esperarSegundos) extra["Retry-After"] = String(e.extra.esperarSegundos);
  return json({ erro: { codigo: e.codigo, mensagem: e.message, ...e.extra } }, e.status, extra);
}

export async function POST(pedido: Request) {
  try {
    // 1. Ler o corpo com um teto de tamanho, antes de o interpretar.
    const maxBytes = config.maxCaracteres() * 4 + 1024;
    const bruto = await pedido.text();
    if (Buffer.byteLength(bruto) > maxBytes) {
      throw new ErroApp(413, "texto_demasiado_longo", `O texto é demasiado grande. O máximo são ${config.maxCaracteres()} caracteres.`);
    }

    let corpo: unknown;
    try {
      corpo = JSON.parse(bruto);
    } catch {
      throw new ErroApp(400, "pedido_invalido", "O pedido não está num formato válido.");
    }
    const lido = PedidoSchema.safeParse(corpo);
    if (!lido.success) throw new ErroApp(400, "pedido_invalido", "O pedido não está num formato válido.");

    // 2. Validar o texto.
    const texto = lido.data.texto.trim();
    if (!texto) throw new ErroApp(400, "texto_vazio", "Escreve ou cola primeiro o texto que queres analisar.");
    if (texto.length > config.maxCaracteres()) {
      throw new ErroApp(413, "texto_demasiado_longo", `O texto tem ${texto.length} caracteres e o máximo são ${config.maxCaracteres()}.`);
    }

    // 3. Sofrimento sério: sai do modo análise, sem chamar o modelo e sem gastar do limite.
    if (emCrise(texto)) return json({ cuidado: CUIDADO } satisfies RespostaApi);

    // 4. Limites de pedidos. Hoje por IP; com contas, por utilizador.
    const acesso = await obterAcesso(pedido);
    const chave = acesso.utilizadorId ?? ipDoPedido(pedido.headers);
    const limite = verificarLimites(chave);
    if (!limite.ok) {
      const mensagem =
        limite.motivo === "global"
          ? "A análise atingiu o limite de hoje. Volta amanhã."
          : "Fizeste muitas análises seguidas. Tenta outra vez mais tarde.";
      throw new ErroApp(429, "limite_pedidos", mensagem, { esperarSegundos: limite.esperarSegundos });
    }

    // 5. Analisar.
    const chamar: ChamarModelo = config.simulado() ? mockModelo : chamarAnthropic;
    const { analise, tentativas } = await analisar({ ...lido.data, texto }, lerSkill(), chamar);
    return json({ analise, meta: { modelo: config.simulado() ? "simulado" : config.modelo(), tentativas } } satisfies RespostaApi);
  } catch (e) {
    if (e instanceof ErroApp) return erro(e);
    console.error("[api/analisar] erro inesperado:", e);
    return erro(new ErroApp(500, "erro_interno", "Algo correu mal do nosso lado. Tenta outra vez."));
  }
}
