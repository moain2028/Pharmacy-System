import { loadConfig } from "./infra/config.js";
import { createApp } from "./bootstrap.js";

const cfg = loadConfig();
const app = await createApp(cfg);
await app.listen({ port: cfg.PORT, host: cfg.HOST });
console.log(`PharmaCore API listening on http://${cfg.HOST}:${cfg.PORT}/api/v1`);
