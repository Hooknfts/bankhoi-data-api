// Vercel serverless entrypoint: re-export the Express app from server.mjs.
// vercel.json rewrites every path here, so /v1/price, /health, /openapi.json
// and /.well-known/x402 all keep their root URLs.
import app from "../server.mjs";

export default app;
