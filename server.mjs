// Bankhoi Data API — pay-per-call crypto data API (x402 v2, Base mainnet, USDC).
// Owner: Hoirunas Fitrah (bankhoict1). Payments go to the user's Base wallet DE34CF.
// Free: GET / , GET /health, GET /openapi.json
// Paid ($0.01/call, x402 "exact" scheme, network eip155:8453):
//   GET /v1/price?symbol=<coingecko-id>   (e.g. bitcoin, binancecoin, ethereum)
//   GET /v1/trending
// Data source: CoinGecko free API (no key), cached in memory.
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import fs from "node:fs";

const PORT = Number(process.env.PORT || 3000);
const PAY_TO = "0xde34cf4e430125b59ad9afef7dff295cec6953d5"; // user wallet DE34CF (Base)
const NETWORK = "eip155:8453"; // Base mainnet
const PRICE = "$0.01";
const LOG = new URL("./api.log", import.meta.url).pathname;

function logLine(s) {
  const line = `${new Date().toISOString()} ${s}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG, line); } catch {}
}

// --- CoinGecko (60s per-symbol cache, 5m trending cache) ---
const cache = new Map(); // key -> { ts, data }
async function cg(path, ttlMs) {
  const now = Date.now();
  const hit = cache.get(path);
  if (hit && now - hit.ts < ttlMs) return hit.data;
  const r = await fetch(`https://api.coingecko.com/api/v3${path}`, {
    headers: { Accept: "application/json", "User-Agent": "bankhoi-data-api/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const data = await r.json();
  cache.set(path, { ts: now, data });
  return data;
}

// --- OpenAPI doc (servers filled from the live request host) ---
// Each paid operation declares x-payment-info (canonical x402 discovery
// format: price + protocols[{x402:{...}}]) plus a 402 response, so catalogue
// crawlers and the vAPI probe classify the route as priced.
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const X402_AMOUNT = "10000"; // 0.01 USDC (6 decimals)
function xPaymentInfo(req, path, description) {
  const host = req.get("host") || `localhost:${PORT}`;
  const proto = req.get("x-forwarded-proto") || (host.includes("trycloudflare") ? "https" : "http");
  return {
    price: { mode: "fixed", amount: "0.01", currency: "USD" },
    protocols: [{
      x402: {
        x402Version: 2,
        scheme: "exact",
        network: NETWORK,
        amount: X402_AMOUNT,
        resource: `${proto}://${host}${path}`,
        description,
        mimeType: "application/json",
        payTo: PAY_TO,
        asset: USDC_BASE,
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2" },
      },
    }],
  };
}
const X402_402_DESC = "Payment required. x402 v2 payment terms in JSON body + PAYMENT-REQUIRED header.";
function openApiDoc(req) {
  const host = req.get("host") || `localhost:${PORT}`;
  const proto = req.get("x-forwarded-proto") || (host.includes("trycloudflare") ? "https" : "http");
  return {
    openapi: "3.0.3",
    info: {
      title: "Bankhoi Data API",
      version: "1.0.0",
      description:
        "Live crypto price and trending data, pay-per-call with USDC on Base via x402. " +
        "Call a paid endpoint without payment to receive a 402 x402 challenge; pay $0.01 " +
        "USDC (Base) and retry with the X-PAYMENT header. Payments go to the API owner.",
      contact: { name: "bankhoict1" },
    },
    servers: [{ url: `${proto}://${host}` }],
    tags: [{ name: "data", description: "Paid crypto data endpoints" }],
    components: {
      securitySchemes: {
        x402: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "x402",
          description:
            "Pay $0.01 USDC on Base via x402 (exact scheme). Call the endpoint without payment " +
            "to receive a 402 challenge, sign the EIP-3009 transfer authorization, and retry " +
            "with the signed payment in the X-PAYMENT header.",
        },
      },
    },
    paths: {
      "/v1/price": {
        // x-payment-info is ALSO declared at the path level: some catalogue
        // parsers look for the pricing block on the path item, not only on
        // the operation, and the probe reports "no operation" otherwise.
        "x-payment-info": xPaymentInfo(req, "/v1/price", "Live crypto price (CoinGecko) — $0.01 USDC per call on Base."),
        get: {
          tags: ["data"],
          summary: "Live price for one coin",
          description: "Pay-per-call ($0.01 USDC on Base, x402). Price source: CoinGecko.",
          operationId: "getPrice",
          security: [{ x402: [] }],
          parameters: [
            { name: "symbol", in: "query", required: true, description: "CoinGecko coin id, e.g. bitcoin, binancecoin, ethereum, hyperliquid", schema: { type: "string", example: "binancecoin" } },
          ],
          "x-payment-info": xPaymentInfo(req, "/v1/price", "Live crypto price (CoinGecko) — $0.01 USDC per call on Base."),
          "x-price-usdc-base": X402_AMOUNT,
          responses: {
            200: { description: "Price data", content: { "application/json": { schema: { type: "object", properties: { symbol: { type: "string" }, usd: { type: "number" }, usd_24h_change: { type: "number" }, market_cap_usd: { type: "number" }, source: { type: "string" }, cached_at: { type: "string" } } } } } },
            400: { description: "Missing or invalid symbol" },
            402: { description: X402_402_DESC },
            404: { description: "Unknown symbol" },
          },
        },
      },
      "/v1/trending": {
        "x-payment-info": xPaymentInfo(req, "/v1/trending", "Top trending coins (CoinGecko) — $0.01 USDC per call on Base."),
        get: {
          tags: ["data"],
          summary: "Top trending coins",
          description: "Pay-per-call ($0.01 USDC on Base, x402). Trending source: CoinGecko.",
          operationId: "getTrending",
          security: [{ x402: [] }],
          "x-payment-info": xPaymentInfo(req, "/v1/trending", "Top trending coins (CoinGecko) — $0.01 USDC per call on Base."),
          "x-price-usdc-base": X402_AMOUNT,
          responses: {
            200: { description: "Trending coins", content: { "application/json": { schema: { type: "object", properties: { coins: { type: "array", items: { type: "object" } }, source: { type: "string" } } } } } },
            402: { description: X402_402_DESC },
          },
        },
      },
      "/health": {
        get: { summary: "Health check (free)", responses: { 200: { description: "OK" } } },
      },
    },
  };
}

// --- App ---
const app = express();
// Serveo (and any reverse proxy) terminates TLS and forwards plain HTTP;
// trust X-Forwarded-Proto so req.protocol (and the x402 middleware's
// resource URL) is https on the public URL. Without this the 402 challenge
// declares an http:// resource while the OpenAPI doc declares https://,
// and catalogue probes reject the operation as mismatched.
app.set("trust proxy", true);

const facilitatorClient = new HTTPFacilitatorClient({ url: "https://facilitator.payai.network" });
// NOTE: the default x402.org facilitator is TESTNET-only (no eip155:8453 in its
// /supported list). PayAI's public facilitator supports Base mainnet v2 exact
// with no key inside a free credit allowance per receiving wallet; if that
// allowance ever runs out, paid calls fail closed (no charge) and we switch
// facilitators (CDP keys, or a self-run facilitator).
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme());

app.use(paymentMiddleware(
  {
    "GET /v1/price": {
      accepts: [{ scheme: "exact", price: PRICE, network: NETWORK, payTo: PAY_TO }],
      description: "Live crypto price (CoinGecko) — $0.01 USDC per call on Base.",
    },
    "GET /v1/trending": {
      accepts: [{ scheme: "exact", price: PRICE, network: NETWORK, payTo: PAY_TO }],
      description: "Top trending coins (CoinGecko) — $0.01 USDC per call on Base.",
    },
  },
  resourceServer,
));

app.get("/", (req, res) => {
  res.json({
    name: "Bankhoi Data API",
    version: "1.0.0",
    owner: "bankhoict1",
    docs: "/openapi.json",
    paid_endpoints: ["/v1/price?symbol=<id>", "/v1/trending"],
    price: "$0.01 USDC per call (x402, Base mainnet)",
    pay_to: PAY_TO,
  });
});

app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// x402 well-known manifest. vAPI's probe expects the simple "v1" pointer
// format (the one live x402 APIs actually serve, e.g. 100levelup): resources
// is an array of URL STRINGS (not objects), plus the openapi pointer.
// The IETF-draft v2 shape (kind + resources as objects) was rejected:
// "not a version 1 x402 document listing resources".
app.get("/.well-known/x402", (req, res) => {
  const host = req.get("host") || `localhost:${PORT}`;
  const proto = req.get("x-forwarded-proto") || (host.includes("trycloudflare") ? "https" : "http");
  const base = `${proto}://${host}`;
  res.json({
    x402Version: 2,
    provider: "bankhoict1",
    site: base,
    resources: [`${base}/v1/price`, `${base}/v1/trending`],
    openapi: `${base}/openapi.json`,
  });
});

app.get("/openapi.json", (req, res) => res.json(openApiDoc(req)));

app.get("/v1/price", async (req, res) => {
  const symbol = String(req.query.symbol || "").toLowerCase().trim();
  if (!/^[a-z0-9-]{1,64}$/.test(symbol)) {
    return res.status(400).json({ error: "invalid symbol, use a CoinGecko coin id (e.g. bitcoin, binancecoin)" });
  }
  try {
    const data = await cg(`/simple/price?ids=${encodeURIComponent(symbol)}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`, 60_000);
    const row = data[symbol];
    if (!row) return res.status(404).json({ error: "unknown symbol", symbol });
    logLine(`PAID /v1/price symbol=${symbol} usd=${row.usd}`);
    res.json({ symbol, usd: row.usd, usd_24h_change: row.usd_24h_change, market_cap_usd: row.usd_market_cap, source: "coingecko", cached_at: new Date().toISOString() });
  } catch (e) {
    logLine(`ERR /v1/price ${e.message}`);
    res.status(502).json({ error: "upstream unavailable", detail: e.message });
  }
});

app.get("/v1/trending", async (req, res) => {
  try {
    const data = await cg("/search/trending", 300_000);
    const coins = (data.coins || []).slice(0, 7).map((c) => ({
      name: c.item?.name, symbol: c.item?.symbol, market_cap_rank: c.item?.market_cap_rank,
      price_btc: c.item?.data?.price_btc, score: c.item?.score,
    }));
    logLine(`PAID /v1/trending coins=${coins.length}`);
    res.json({ coins, source: "coingecko", cached_at: new Date().toISOString() });
  } catch (e) {
    logLine(`ERR /v1/trending ${e.message}`);
    res.status(502).json({ error: "upstream unavailable", detail: e.message });
  }
});

app.use((req, res) => res.status(404).json({ error: "not found" }));

export default app;

// Local / Render-style run: listen on PORT. On Vercel (VERCEL=1) the app is
// served as a serverless function via api/index.js, so do not listen.
if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    logLine(`listening on 0.0.0.0:${PORT} payTo=${PAY_TO} network=${NETWORK} price=${PRICE}`);
  });
}
