# Bankhoi Data API

Live crypto price and trending data, pay-per-call with USDC on Base via x402 v2.

- Free: `GET /`, `GET /health`, `GET /openapi.json`, `GET /.well-known/x402`
- Paid ($0.01 USDC/call, x402 `exact`, network `eip155:8453`, payTo `0xde34cf4e430125b59ad9afef7dff295cec6953d5`):
  - `GET /v1/price?symbol=<coingecko-id>` — current USD price, 24h change, market cap
  - `GET /v1/trending` — top trending coins

Data: CoinGecko free API (no key), cached in memory (60s per symbol, 5m trending).
Facilitator: PayAI public facilitator.

## Run

```sh
npm install
npm start   # listens on $PORT (default 3000)
```

Deployed as a free web service on Render; listed on vAPI Call.
