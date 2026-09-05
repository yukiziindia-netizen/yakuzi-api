# Integrations — Shopify, WooCommerce, Amazon SP-API

Sellers connect their existing sales channels and keep inventory aligned with
Yukizi. This document covers the architecture, the manual platform setup that
cannot be automated, and how to test locally.

---

## Architecture

Yukizi is the **central inventory system**. Channels never talk to each other:

```
  Shopify ─┐
WooCommerce ┼──▶  Yukizi inventory engine  ──▶ connected channels
   Amazon ─┘        (normalise → decide)
```

Every external change is normalised into an `InventoryEvent` before anything is
applied. That single choke point is what makes loops impossible by construction
rather than by luck — there is no code path where Shopify can update WooCommerce
directly.

### Loop prevention

The specific failure this avoids: Yukizi sets Shopify 5 → 4; Shopify sends a
webhook saying "inventory is now 4"; a naive system treats that as news and
pushes 4 to WooCommerce and Amazon, which each echo back, forever.

Two mechanisms:

| Mechanism | Where | What it stops |
|---|---|---|
| Unique index on `(sourcePlatform, sourceEventId)` | `inventory_events` | The same webhook delivered twice being applied twice. Enforced by Postgres, so it holds across concurrent app instances. |
| Echo detection against the last outbound write | `IntegrationWebhooksService.isEchoOfOurWrite` | An inbound event that merely confirms Yukizi's own update. Recorded with `skipReason: ECHO_OF_OUR_WRITE`, never re-broadcast. |

Events that cannot be matched to a listing are recorded with
`skipReason: NO_MAPPING` rather than dropped, so they surface as "requiring
attention" instead of vanishing.

### Credential security

- Channel credentials are encrypted at rest with **AES-256-GCM** and stored in
  `seller_integrations.encryptedCredentials`. GCM's auth tag means a tampered
  row fails to decrypt rather than yielding attacker-chosen values.
- If `INTEGRATIONS_ENCRYPTION_KEY` is absent, authorization flows **refuse to
  start**. There is no fallback that writes a plaintext token.
- `IntegrationsService.toSellerView()` is the only function that turns a row
  into a seller response, and it never references a credential column — so no
  future field addition can leak one by accident.
- Amazon access tokens are minted from the refresh token in memory and never
  persisted.

### Ownership

Every endpoint resolves the seller from the JWT. No route accepts a `sellerId`.
Cross-seller access returns **404, not 403** — a 403 would confirm the row
exists, which is an enumeration oracle.

### SSRF

WooCommerce is the one flow where the backend fetches a seller-supplied URL.
`store-url.util.ts` rejects loopback, RFC1918, link-local (including the
`169.254.169.254` cloud metadata address), CGNAT, IPv4-mapped IPv6, internal
suffixes, IP literals, credentials-in-URL, and non-standard ports — and
re-resolves the hostname immediately before each request to catch DNS rebinding.

---

## Manual platform configuration

These steps cannot be done from code and are required before the corresponding
card becomes usable. Until they are done, the UI shows the channel as
unavailable rather than offering a button that fails.

### Shopify (Partner Dashboard)

1. Create a **public app** at <https://partners.shopify.com> → Apps → Create app.
2. **App URL**: `https://seller.yukizi.com/integrations`
3. **Allowed redirection URL(s)** — must match `SHOPIFY_REDIRECT_URI` exactly:
   `https://yukizi.com/api/integrations/shopify/callback`
4. Copy the **Client ID** and **Client secret** into the env.
5. Scopes requested at runtime (no separate config needed):
   `read_products`, `read_inventory`, `write_inventory`, `read_locations`.
   No customer or order scopes are requested, so no protected-data approval is
   required.
6. For public distribution, submit the app for review. Until then it can be
   installed on development stores.

### WooCommerce (seller-side, no Yukizi config)

Nothing to register. Each seller's store generates its own key pair. Sellers
need:

- WordPress with WooCommerce active
- HTTPS with a valid certificate
- Pretty permalinks enabled (Settings → Permalinks → anything but "Plain")
- The REST API reachable (some security plugins, e.g. Wordfence, block
  non-browser agents and must allow Yukizi)
- An account with permission to create API keys

### Amazon (Solution Provider Portal)

1. Register as a developer in Seller Central → Apps & Services → Develop Apps.
2. Create an SP-API app. Roles needed for this feature:
   **Product Listing** (and **Inventory and Order Tracking** if FBA inventory
   display is wanted later). Do not request PII roles.
3. **OAuth Login URI**: `https://seller.yukizi.com/integrations`
   **OAuth Redirect URI**: `https://yukizi.com/api/integrations/amazon/callback`
4. Copy the LWA **Client ID**, **Client secret**, and the **App ID**
   (`amzn1.sp.solution.…`) into the env.
5. While the app is in **draft**, keep `AMAZON_SP_API_APP_DRAFT=true` — Amazon
   requires `version=beta` on the consent URL for draft apps. Set it to `false`
   only once the app is published, or published authorizations will fail.

---

## Local testing

Provider callbacks need a public HTTPS URL, so a tunnel is required:

```bash
# 1. Expose the local API
ngrok http 3000        # or: cloudflared tunnel --url http://localhost:3000

# 2. Point the env at the tunnel
API_PUBLIC_URL=https://<subdomain>.ngrok-free.app/api
SHOPIFY_REDIRECT_URI=https://<subdomain>.ngrok-free.app/api/integrations/shopify/callback
AMAZON_REDIRECT_URI=https://<subdomain>.ngrok-free.app/api/integrations/amazon/callback
SELLER_APP_URL=http://localhost:3003

# 3. Generate an encryption key
openssl rand -hex 32   # -> INTEGRATIONS_ENCRYPTION_KEY

# 4. Update the same redirect URIs in the Shopify/Amazon app settings.
```

Then:

```bash
npx prisma migrate deploy     # or: npx prisma db push
npm run start:dev             # API on :3000
cd ../yakuzi-web/apps/seller && npm run dev   # seller app on :3003
```

- **Shopify**: use a development store (free from the Partner Dashboard).
- **WooCommerce**: any public WordPress+Woo site. A LocalWP install will NOT
  work — the SSRF guard correctly refuses private addresses, and WooCommerce
  needs to reach the callback anyway.
- **Amazon**: SP-API has a sandbox, but OAuth consent requires a real Seller
  Central account.

Run the tests (no external credentials needed — the network is mocked):

```bash
npx jest src/modules/integrations
```

---

## Deployment

1. Set the env vars (see `.env.integrations.example`).
   `INTEGRATIONS_ENCRYPTION_KEY` must be **identical across all API instances**
   or one instance cannot decrypt what another wrote.
2. Ship the schema. `deploy-api.yml` already runs `prisma migrate deploy`; note
   the `start:prod` script also runs `prisma db push`. The migration is purely
   additive — it creates 7 tables and 11 enums and alters no existing table.
3. Register the production redirect URIs with Shopify and Amazon.
4. Verify: the Integrations page should show three cards, with a channel marked
   available only once its credentials are present.

### Key rotation

Changing `INTEGRATIONS_ENCRYPTION_KEY` makes existing credentials
undecryptable. The hourly health check detects this and flips affected
connections to **Action required**, prompting sellers to reconnect — it does not
fail silently. `credentialsKeyVersion` and the `v1.` envelope prefix exist so a
future re-wrapping migration can be written instead.

---

## Product import and SKU mapping (phase 2)

### The matching rule

In order, and nothing else:

1. **An existing mapping.** A mapping the seller made by hand is never
   overwritten by a later import.
2. **Exact SKU match** against the seller's own listings (`SellerOffer.sku`).
3. **Exact variant SKU match** (`ProductVariant.sku`).
4. **Otherwise, leave it for the seller.**

Comparison is case-insensitive and trims whitespace. **Product names are never
used.** Two products called "Naruto Figure" on two channels are not evidence
they are the same thing, and merging them silently would corrupt a seller's
stock in a way that is very hard to notice afterwards.

Where the answer is genuinely ambiguous the row becomes `CONFLICT` with a
reason, and Yukizi does not choose:

| `conflictReason` | Meaning |
|---|---|
| `SKU_MATCHES_MULTIPLE_PRODUCTS` | One channel SKU matches several Yukizi listings |
| `SKU_SHARED_BY_EXTERNAL_LISTINGS` | Several channel listings share one SKU |
| `NO_SKU` | The listing has no SKU at all (`MISSING_SKU`) |

### Inventory import

Quantities are pulled only for `MAPPED`, merchant-fulfilled rows. When Yukizi
and the channel disagree:

- If the seller made **that channel** the source of truth, the channel quantity
  is applied.
- Otherwise the difference is **flagged and nothing is written**. The seller
  resolves it per listing on the mapping screen ("Keep Yukizi 12" / "Use
  Shopify 7").

Stock is written through `InventoryService.updateDefaultBatch()` — the same path
the seller portal itself uses — so imported stock behaves identically to stock
typed into the UI, including low-stock alerts. Every write is recorded in
`inventory_events` as PENDING first and marked PROCESSED only after it lands, so
a crash halfway leaves an auditable row rather than a silent discrepancy.

**Amazon FBA is excluded from the write path entirely.** MFN and FBA
availability arrive as separate rows with different `fulfillmentChannel` values;
FBA quantities are imported for display and never treated as seller-controlled
stock.

### The job runner

`IntegrationJobRunnerService` runs every minute (`@Cron`), following the repo's
existing background-work pattern. Notable properties:

- Jobs are claimed by **compare-and-swap** (`updateMany` on `status: PENDING`),
  so two API instances cannot run the same job twice.
- A catalogue larger than one run's page budget (20 pages) **re-queues itself
  with a cursor**, so a large store makes steady progress instead of timing out.
- Requests are serial with a pause between pages. Bursting parallel requests at
  a seller's store is how integrations get rate-limited or firewalled.
- Retries back off quadratically (1m, 4m, 9m, …, capped at 30m). **429 is
  retried** — that is what backoff is for. **401/403 are permanent**: no number
  of attempts fixes a revoked token, and repeating it looks like an attack. The
  connection is flipped to *Action required* instead.
- Stored errors carry the HTTP status only, never a provider response body.

---

## What is implemented, and what is not

**Phases 1 and 2 — complete and real:**
Integrations UI; the full data model; Shopify OAuth; WooCommerce
`/wc-auth/v1/authorize`; Amazon LWA/SP-API; encrypted credential storage;
connection health with an hourly probe; disconnect with remote webhook cleanup;
setup wizard; sync activity log; signature-verified webhook receivers with
idempotency and loop protection; catalogue import for all three channels; SKU
matching with explicit conflict states; manual mapping; inventory import with
seller-resolved conflicts; and the background job runner with retry/backoff.

**Not yet implemented (phase 3):** pushing Yukizi quantities outward to
channels, automatic webhook registration at connect time, and scheduled
reconciliation sweeps. `SyncJobType.INVENTORY_PUSH` and `WEBHOOK_REGISTRATION`
are rejected by the runner rather than silently marked complete.

Consequently, **two-way sync is still refused by the API**
(`supportsTwoWaySync()` returns `false`), and resolving an inventory difference
in Yukizi's favour clears the flag without pushing the correction to the channel
— the UI says exactly that rather than claiming the channel was updated.

Price and order sync remain **Coming soon** in the UI, with columns reserved
(`syncPrices`, `syncOrders`) that no job reads.
