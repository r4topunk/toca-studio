# Visao geral

Este projeto descreve um app de descoberta + curadoria de arte / drops, com integracao a carteiras para salvar/seguir e comprar/coletar dentro do app quando fizer sentido (para preservar referral e UX).

## Entidades (primitivos)

- Artista: perfil publico + obras + colecoes.
- Item/Obra: unidade de midia (img/video/html/iframe) com metadata, origem (Zora/FC) e CTAs.
- Colecao: agrupamento de itens com texto curatorial.
- Colecionador: usuario com wallet conectada + perfil publico (opcional) e link de referral.

## Atores

- Visitante: navega livremente, sem wallet.
- Colecionador: conecta wallet, salva/segue, compra/coleta no app.
- Artista/Curador: aparece no diretório e tem paginas/colecoes, nao necessariamente cria coisas dentro do app no MVP.

## Principios de UX (aprendidos e adaptados de vvv.so)

- Numeros operacionais aparecem cedo: progresso, volume, disponibilidade, custo total.
- Conectar wallet e um "modo", nao o "começo": navegar deve funcionar sem wallet.
- Quando existe referral/control (comprar no app), isso precisa ser um CTA claro e recorrente.

