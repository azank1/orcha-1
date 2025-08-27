import express from "express";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());

// ---- MOCK STATE (no FoodTec calls) ----
const MENU_TTL_MS = Number(process.env.CACHE_TTL_SEC ?? 600) * 1000;
const menuCache = new Map<string, { t:number; data:any }>();
const acceptLedger = new Map<string, any>(); // Idempotency-Key -> confirmation

// ---- Helpers ----
function ok(res: any, data: any) { return res.json({ ok: true, ...data }); }
function err(res: any, code: string, message: string, status = 400, meta: any = {}) {
  return res.status(status).json({ ok: false, code, message, meta: { status, ...meta } });
}

// ---- GET /apiclient/menu (MOCK + cache) ----
app.get("/apiclient/menu", async (req, res) => {
  const store = String(req.query.store_id ?? "default");
  const key = `menu:${store}`;
  const now = Date.now();
  const hit = menuCache.get(key);
  if (hit && now - hit.t < MENU_TTL_MS) return res.json(hit.data);

  // minimal mock menu
  const data = {
    ok: true,
    store_id: store,
    categories: [
      {
        id: "pizzas",
        name: "Pizzas",
        items: [
          { sku: "LARGE_PEP", name: "Large Pepperoni", price: 14.99 },
          { sku: "MED_MARG", name: "Medium Margherita", price: 11.49 }
        ]
      }
    ]
  };
  menuCache.set(key, { t: now, data });
  return res.json(data);
});

// ---- POST /apiclient/validateOrder (MOCK validation) ----
app.post("/apiclient/validateOrder", async (req, res) => {
  const draft = req.body || {};
  if (!draft.items || !Array.isArray(draft.items) || draft.items.length === 0) {
    return err(res, "VALIDATION", "No items provided", 422);
  }

  // simple mock rule: only allow known SKUs
  const allowed = new Set(["LARGE_PEP", "MED_MARG"]);
  const bad = (draft.items as any[]).filter(i => !allowed.has(i.sku));
  if (bad.length) {
    return err(res, "VALIDATION", `Unknown SKU(s): ${bad.map(b => b.sku).join(", ")}`, 422);
  }
  return ok(res, { totals: { amount: 18.75, currency: "USD" }, substitutions: [], warnings: [] });
});

// ---- POST /apiclient/acceptOrder (MOCK + Idempotency) ----
app.post("/apiclient/acceptOrder", async (req, res) => {
  const idem = req.header("Idempotency-Key") || randomUUID();
  if (acceptLedger.has(idem)) {
    res.setHeader("Idempotency-Key", idem);
    return res.json(acceptLedger.get(idem));
  }
  const draft = req.body || {};
  if (!draft.items || !Array.isArray(draft.items) || draft.items.length === 0) {
    return err(res, "VALIDATION", "No items provided", 422);
  }
  const confirmation = {
    ok: true,
    order_id: `PB-${Date.now()}`,
    eta_minutes: 25,
    received_at: new Date().toISOString()
  };
  acceptLedger.set(idem, confirmation);
  res.setHeader("Idempotency-Key", idem);
  return res.json(confirmation);
});

// health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 8080, () =>
  console.log("Mock Policy Proxy listening on", process.env.PORT || 8080)
);
