# Pesquisa: vvv.so (referencia de UX)

Fonte: crawl local em `output/vvv/` (HTML + screenshots + report).

Artefatos uteis:

- Report: `output/vvv/report.md`
- Screenshots: `output/vvv/screenshots/`
- HTML snapshots: `output/vvv/pages/`

## Estrutura de informacao (o que existe no site)

- Home: lista de colecoes com indicadores (ex: % mintado, volume em SOL) + busca + recortes como "Recently Minted".
- Create Collection: um wizard em 3 passos (Collection Details, Upload and Preview, Deploy) bloqueado por wallet.
- Pagina de colecao (slug): detalhes + "Whitelist Phases" + acao de mint + "Mint Summary" (breakdown de custo/fees).

## Padroes reutilizaveis

- Cartoes de lista com "numero primeiro": mostrar progresso/estado (ex: % mintado) e um KPI (ex: volume) diretamente no card.
- Tabela/lista de fases: nome da fase, preco, janela de tempo, status (Active) e limite por wallet.
- "Mint summary" (quase sempre embaixo do CTA): breakdown do custo total em linhas simples (preco base + fee de plataforma + taxa extra).
- Wallet connect como controle contextual: botao "Select Wallet" sempre visivel, mas navegação sem wallet ainda funciona (exceto criar e mint).

## Observacoes tecnicas (sinais no crawl)

- Existe mitigacao anti-bot (assets e scripts identificaveis no HTML).
- Algumas paginas retornaram "Minified React error #418" durante o crawl (indicando que nem toda pagina e estavel para automacao/bots).

## Adaptacao para este projeto

- Copiar: "numero primeiro" no feed (progresso/estado + KPI) e breakdown de custo perto do CTA de compra/coleta.
- Copiar: tabela simples de fases/condicoes quando existir (public, allowlist, janelas de tempo, limites).
- Nao copiar literal: SOL/mint/launchpad se o fluxo real for Zora/FC; manter o padrao de informacao, trocar o conteudo.
