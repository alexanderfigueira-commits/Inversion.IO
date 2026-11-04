# Trilogia Chat (protótipo)

App de conversa por texto e voz que responde na lente da Trilogia Analítica, cita excertos dos livros
com a origem, e leva o leitor a comprar o livro na editora.

Regras comerciais: **10 minutos grátis** (não se repõem), depois **30 minutos por semana** por **50 €**
(preço e período configuráveis em `server/src/config.js` ou por variáveis de ambiente).

## O que está pronto e testado

- `server/`: servidor Node, sem dependências. Pesquisa nos livros, chama a IA, mede o tempo de uso
  e bloqueia quando acaba. 9 testes (`npm test`).
- `server/public/index.html`: demonstração no browser, para testar já sem Xcode.
- `ios/KeppeChat/`: app SwiftUI (chat, voz pt-PT, ecrã de subscrição StoreKit 2).

## Experimentar em 30 segundos

```bash
cd keppe-app/server
DEV_MODE=1 npm start        # abre http://localhost:8787
```

Sem `ANTHROPIC_API_KEY` corre em modo demonstração (responde com o excerto mais próximo). Com a chave:

```bash
ANTHROPIC_API_KEY=... DEV_MODE=1 npm start
```

`DEV_MODE=1` ativa o botão "Subscrever (simulação)". Nunca ligar em produção.

## Pôr os livros (só com licença da editora)

1. Pedir autorização escrita à editora para os excertos e para usar o nome do autor.
2. Colocar cada livro em `server/data/books/NOME.txt` (formato descrito em `server/scripts/ingest.js`).
3. `npm run ingest` gera `data/corpus.local.json`, que o git ignora.

O `data/corpus.json` incluído tem só textos de demonstração, escritos por nós e marcados como
"não é do autor". Não contém texto de livros reais.

## Ainda por fazer antes de publicar

1. **Validar a compra da Apple no servidor.** `/api/subscription/verify` devolve 501 fora de `DEV_MODE`.
   É preciso validar o JWS com a App Store Server API (ou a biblioteca oficial `@apple/app-store-server-library`),
   guardar a data de expiração e tratar renovações e cancelamentos. Sem isto qualquer pessoa pagaria zero.
2. **Rever o texto da lente** em `server/prompts/framework.md` com quem conhece a obra. É um rascunho.
3. **Criar o projeto no Xcode** (iOS 17+, SwiftUI), arrastar os ficheiros de `ios/KeppeChat/`, e ativar:
   StoreKit (produto `pt.keppechat.subscription.monthly`), e no Info.plist as chaves
   `NSMicrophoneUsageDescription` e `NSSpeechRecognitionUsageDescription`. O código Swift foi escrito
   mas **não foi compilado** neste ambiente (não há Xcode aqui).
4. **Servidor online** com HTTPS (a app aponta para `localhost` em `APIClient.swift`) e a chave da IA só no servidor.
5. **Contas e proteção do período grátis.** Hoje o grátis é por aparelho (Keychain). Para mais robustez, DeviceCheck ou login.
6. **Texto legal:** termos, política de privacidade (as conversas vão para um serviço de IA), aviso de que não é terapia.
7. **Licença e nome:** autorização da editora e do titular dos direitos antes de qualquer excerto real ou uso do nome do autor.

## Segurança já incluída

- A chave da IA nunca está na app.
- A IA só pode citar excertos recuperados; a app só mostra citações que a resposta marcou.
- Mensagens sobre fazer mal a si próprio recebem uma resposta fixa com 112 e SNS 24, sem passar pelo modelo e sem gastar tempo.
- O limite de tempo é decidido no servidor, nunca na app.
