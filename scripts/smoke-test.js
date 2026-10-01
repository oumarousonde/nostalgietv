// Test de fumée : charge l'app EXACTEMENT comme Vercel le fait (dist/api/index.js,
// export par défaut) puis interroge les routes qui n'ont pas besoin de base de données.
// Usage : npm run verify   (compile d'abord, puis lance ce script)
process.env.DATABASE_URL ||= "postgresql://user:pass@localhost:5432/test";
process.env.JWT_SECRET ||= "smoke-test-secret";
process.env.PUBLIC_BASE_URL ||= "https://exemple.test";

const http = require("http");
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
  if (!ok) failures++;
};

(async () => {
  const mod = require("../dist/api/index.js");
  const handler = mod.default ?? mod;
  check("api/index : export par défaut = fonction (sinon Vercel plante)", typeof handler === "function", typeof handler);
  if (typeof handler !== "function") process.exit(1);

  const server = http.createServer(handler).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, opts) => fetch(base + path, opts);

  let r = await get("/status");
  check("GET /status  -> 200", r.status === 200, r.status);
  r = await get("/");
  check("GET /  -> 200 (sert la maquette HTML)", r.status === 200, r.status);
  r = await get("/robots.txt");
  const txt = await r.text();
  check("GET /robots.txt -> 200 + Sitemap absolu", r.status === 200 && /Sitemap: https?:\/\//.test(txt), txt);
  r = await get("/favicon.ico");
  check("GET /favicon.ico -> pas 401", r.status !== 401, r.status);
  r = await get("/route-inexistante");
  check("route inconnue -> 404 (pas 401/403)", r.status === 404, r.status);
  r = await get("/credits/balance");
  check("GET /credits/balance sans token -> 401", r.status === 401, r.status);
  r = await get("/admin/support/messages");
  check("GET /admin/... sans token -> 401", r.status === 401, r.status);
  r = await get("/uploads/handshake", { method: "POST" });
  check("POST /uploads/handshake sans token -> 401", r.status === 401, r.status);

  server.close();
  console.log(failures ? `\n${failures} test(s) en échec — NE PAS déployer.` : "\nTout est bon.");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAIL  chargement de l'app :", e); process.exit(1); });
