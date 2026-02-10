# Referral (colecionador e plataforma)

## Como o “referral do colecionador” encaixa sem magia

- **Plataforma (você):** ganha *platform referral* quando um coin é criado com `platformReferrer` setado na criação. Isso fica “sticky” no coin.
- **Colecionador (perfil dele):** ganha *trade referral* por trade individual quando o swap passa um `tradeReferrer` (via hook data no swap/roteador). Isso permite referral “por link do perfil” se a compra ocorrer no seu app (onde você controla o trade call).

Implicação de produto (na página do item):

- `Comprar (no app)`: aplica trade referral do `?ref=` do link do perfil.
- `Abrir no Zora`: bom para descoberta, mas pode não carregar o referral do colecionador (depende do cliente externo).

Referência: https://docs.zora.co/coins/contracts/earning-referral-rewards

