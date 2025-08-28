diff --git a//dev/null b/proxy/src/index.ts
index 0000000000000000000000000000000000000000..e91223a16e7f651ed4b8769099e24e408fdc4767 100644
--- a//dev/null
+++ b/proxy/src/index.ts
@@ -0,0 +1,50 @@
+import express from "express";
+import { randomUUID } from "crypto";
+const app = express(); app.use(express.json());
+
+// in-memory cache + idempotency (MVP mock)
+const MENU_TTL_MS = 600_000;
+const menuCache = new Map<string, { t:number; data:any }>();
+const acceptLedger = new Map<string, any>();
+
+const ok = (res:any, data:any) => res.json({ ok:true, ...data });
+const err = (res:any, code:string, msg:string, status=400) =>
+  res.status(status).json({ ok:false, code, message:msg, meta:{ status } });
+
+// GET /apiclient/menu → mock menu (cached)
+app.get("/apiclient/menu", (req, res) => {
+  const store = String(req.query.store_id ?? "default");
+  const k = `menu:${store}`, hit = menuCache.get(k), now = Date.now();
+  if (hit && now - hit.t < MENU_TTL_MS) return res.json(hit.data);
+  const data = { ok:true, store_id:store, categories:[{ id:"pizzas", name:"Pizzas",
+    items:[{ sku:"LARGE_PEP", name:"Large Pepperoni", price:14.99 },
+           { sku:"MED_MARG", name:"Medium Margherita", price:11.49 }]}] };
+  menuCache.set(k, { t: now, data }); return res.json(data);
+});
+
+// POST /apiclient/validateOrder → mock validation
+app.post("/apiclient/validateOrder", (req, res) => {
+  const d = req.body || {};
+  if (!d.items || !Array.isArray(d.items) || !d.items.length)
+    return err(res, "VALIDATION", "No items provided", 422);
+  const allowed = new Set(["LARGE_PEP","MED_MARG"]);
+  const bad = d.items.filter((i:any)=>!allowed.has(i.sku));
+  if (bad.length) return err(res, "VALIDATION", `Unknown SKU(s): ${bad.map((b:any)=>b.sku).join(", ")}`, 422);
+  return ok(res, { totals:{ amount:18.75, currency:"USD" }, warnings:[] });
+});
+
+// POST /apiclient/acceptOrder → mock confirmation (idempotent)
+app.post("/apiclient/acceptOrder", (req, res) => {
+  const idem = req.header("Idempotency-Key") || randomUUID();
+  if (acceptLedger.has(idem)) { res.setHeader("Idempotency-Key", idem); return res.json(acceptLedger.get(idem)); }
+  const d = req.body || {};
+  if (!d.items || !Array.isArray(d.items) || !d.items.length)
+    return err(res, "VALIDATION", "No items provided", 422);
+  const conf = { ok:true, order_id:`PB-${Date.now()}`, eta_minutes:25, received_at:new Date().toISOString() };
+  acceptLedger.set(idem, conf); res.setHeader("Idempotency-Key", idem); return res.json(conf);
+});
+
+// health
+app.get("/healthz", (_req,res)=>res.json({ ok:true }));
+
+app.listen(process.env.PORT || 8080, ()=>console.log("Mock Policy Proxy on", process.env.PORT || 8080));
