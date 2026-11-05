#!/usr/bin/env bash
# Testa a rota /api/analisar com curl, contra um servidor já a correr.
#
#   Terminal 1:  MOCK_IA=1 LIMITE_HORA=6 npm run dev
#   Terminal 2:  npm run test:api
#
# BASE e LIMITE_HORA podem ser mudados por variáveis (LIMITE_HORA tem de ser igual ao do servidor).
set -u
BASE="${BASE:-http://localhost:3000}"
LIMITE="${LIMITE_HORA:-6}"
URL="$BASE/api/analisar"
TMP="$(mktemp)"
FALHAS=0

# post NOME ESTADO_ESPERADO IP CORPO_JSON  -> deixa o corpo da resposta em $TMP
post() {
  local nome="$1" esperado="$2" ip="$3" corpo="$4" estado
  estado=$(curl -s -o "$TMP" -w '%{http_code}' -X POST "$URL" \
    -H 'content-type: application/json' -H "x-forwarded-for: $ip" -d "$corpo")
  if [ "$estado" = "$esperado" ]; then echo "  ok   $nome ($estado)"; else echo "  FALHOU $nome: esperava $esperado, veio $estado"; cat "$TMP"; echo; FALHAS=$((FALHAS+1)); fi
}

# campo EXPRESSAO_JS  -> imprime o resultado de uma expressão sobre o corpo (variável j)
campo() { node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));console.log($1)"; }

verifica() { # NOME VALOR_ESPERADO EXPRESSAO
  local obtido; obtido="$(campo "$3")"
  if [ "$obtido" = "$2" ]; then echo "  ok   $1 ($obtido)"; else echo "  FALHOU $1: esperava '$2', veio '$obtido'"; FALHAS=$((FALHAS+1)); fi
}

echo "== Análise normal (modo trilógico, sem debate)"
post "devolve 200" 200 10.0.0.1 '{"texto":"Devo despedir o meu sócio porque a equipa não tem motivação.","modo":"trilogico","debate":false}'
verifica "tem as quatro partes de inversao" "4" "Object.keys(j.analise.inversao).length"
verifica "síntese entre 4 e 6" "true" "j.analise.sintese.length>=4&&j.analise.sintese.length<=6"
verifica "escala entre 1 e 4" "true" "j.analise.escala>=1&&j.analise.escala<=4"
verifica "sem debate quando não é pedido" "undefined" "typeof j.analise.debate"
verifica "veredito presente (há decisão)" "true" "!!j.analise.veredito"
verifica "uma só tentativa" "1" "j.meta.tentativas"

echo "== Debate pedido"
post "devolve 200" 200 10.0.0.2 '{"texto":"A equipa está desmotivada.","modo":"trilogico","debate":true}'
verifica "seis agentes" "6" "j.analise.debate.length"
verifica "sem veredito quando não há decisão" "undefined" "typeof j.analise.veredito"

echo "== Linguagem simples"
post "devolve 200" 200 10.0.0.3 '{"texto":"A equipa está desmotivada.","modo":"simples","debate":false}'
verifica "sem jargão na raiz" "false" "/teomania|inversão/i.test(j.analise.inversao.raiz)"

echo "== Sem inversão relevante"
post "devolve 200" 200 10.0.0.4 '{"texto":"[[sem-inversao]] Vou ouvir os clientes antes de decidir.","modo":"trilogico","debate":false}'
verifica "semInversaoRelevante" "true" "j.analise.semInversaoRelevante"

echo "== Validação do formato (repetição)"
post "JSON estragado, repete e recupera" 200 10.0.0.5 '{"texto":"[[invalido]] teste","modo":"trilogico","debate":false}'
verifica "duas tentativas" "2" "j.meta.tentativas"
post "JSON com cercas de markdown" 200 10.0.0.5 '{"texto":"[[cerca]] teste","modo":"trilogico","debate":false}'
post "sempre inválido dá erro claro" 502 10.0.0.5 '{"texto":"[[sempre-invalido]] teste","modo":"trilogico","debate":false}'
verifica "código do erro" "resposta_invalida" "j.erro.codigo"

echo "== Pedidos inválidos"
post "texto vazio" 400 10.0.0.6 '{"texto":"   ","modo":"trilogico","debate":false}'
verifica "código" "texto_vazio" "j.erro.codigo"
post "JSON inválido" 400 10.0.0.6 'isto não é json'
post "modo desconhecido" 400 10.0.0.6 '{"texto":"olá","modo":"outro"}'
post "texto demasiado longo" 413 10.0.0.6 "{\"texto\":\"$(head -c 5000 /dev/zero | tr '\0' 'a')\"}"
verifica "código" "texto_demasiado_longo" "j.erro.codigo"
post "corpo gigante" 413 10.0.0.6 "{\"texto\":\"$(head -c 40000 /dev/zero | tr '\0' 'a')\"}"

echo "== Sofrimento sério (não chama o modelo)"
post "devolve cuidado" 200 10.0.0.7 '{"texto":"Penso em suicídio.","modo":"trilogico","debate":false}'
verifica "tem mensagem de cuidado e não tem análise" "true" "!!j.cuidado&&!j.analise"

echo "== Limite por IP ($LIMITE por hora)"
for i in $(seq 1 "$LIMITE"); do
  estado=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" -H 'content-type: application/json' -H 'x-forwarded-for: 10.0.1.1' -d '{"texto":"olá mundo"}')
  [ "$estado" = "200" ] || { echo "  FALHOU pedido $i devia ser 200, veio $estado"; FALHAS=$((FALHAS+1)); }
done
echo "  ok   $LIMITE pedidos aceites"
cab=$(curl -s -D - -o "$TMP" -X POST "$URL" -H 'content-type: application/json' -H 'x-forwarded-for: 10.0.1.1' -d '{"texto":"olá mundo"}')
echo "$cab" | head -1 | grep -q 429 && echo "  ok   o pedido seguinte dá 429" || { echo "  FALHOU: esperava 429"; FALHAS=$((FALHAS+1)); }
echo "$cab" | grep -qi '^retry-after:' && echo "  ok   tem Retry-After" || { echo "  FALHOU: sem Retry-After"; FALHAS=$((FALHAS+1)); }
post "outro IP não é afetado" 200 10.0.1.2 '{"texto":"olá mundo"}'

echo "== Método errado"
estado=$(curl -s -o /dev/null -w '%{http_code}' "$URL"); [ "$estado" = "405" ] && echo "  ok   GET dá 405" || { echo "  FALHOU: GET devia dar 405, deu $estado"; FALHAS=$((FALHAS+1)); }

rm -f "$TMP"
echo
if [ "$FALHAS" -eq 0 ]; then echo "TUDO OK"; else echo "$FALHAS falha(s)"; exit 1; fi
