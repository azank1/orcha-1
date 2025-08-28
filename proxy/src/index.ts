// proxy/src/index.ts
import express from "express";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());

// --- MVP MOCKS (no upstream calls yet) ---
// cache menu 10 minutes (adjust via env later)
const MENU_TTL_MS = 600_000;
const menuCache = new Map<string, { t: number; data: any }>();

// ledger for idempotent acceptOrder
const acceptLedger = new Map<string, any>();

// helpers
const ok = (res: any, data: any) => res.json({ ok: true, ...data });
const err = (res: any, code: string, msg: string, status = 400) =>
  res.status(status).json({ ok: false, code, message: msg, meta: { status } });

/**
 * GET /apiclient/menu
 * - Returns a cached mock menu for the store (if provided).
 * - Mirrors FoodTec "Menu Export" behavior enough for orchestration tests.
 */
app.get("/apiclient/menu", (req, res) => {
  const store = String(req.query.store_id ?? "default");
  const key = `menu:${store}`;
  const hit = menuCache.get(key);
  const now = Date.now();

  if (hit && now - hit.t < MENU_TTL_MS) return res.json(hit.data);

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

/**
 * POST /apiclient/validateOrder
 * - Validates a mock order draft.
 * - Returns VALIDATION error for bad/missing items (422).
 */
app.post("/apiclient/validateOrder", (req, res) => {
  const draft = req.body || {};
  if (!draft.items || !Array.isArray(draft.items) || draft.items.length === 0) {
    return err(res, "VALIDATION", "No items provided", 422);
  }

  // simple allow-list: enough to test agent→MCP→proxy flow
  const allowed = new Set(["LARGE_PEP", "MED_MARG"]);
  const bad = (draft.items as any[]).filter((i) => !allowed.has(i.sku));
  if (bad.length) {
    return err(
      res,
      "VALIDATION",
      `Unknown SKU(s): ${bad.map((b) => b.sku).join(", ")}`,
      422
    );
  }

  return ok(res, {
    totals: { amount: 18.75, currency: "USD" },
    warnings: [],
    substitutions: []
  });
});

/**
 * POST /apiclient/acceptOrder
 * - Mints/uses Idempotency-Key to avoid duplicate orders.
 * - Returns a mock confirmation payload.
 */
app.post("/apiclient/acceptOrder", (req, res) => {
  const idem = req.header("Idempotency-Key") || randomUUID();

  // replay: return same confirmation without "placing" again
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

// healthz
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// start
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(`Mock Policy Proxy on :${PORT}`);
});

export {}; // keep TS module mode happy
