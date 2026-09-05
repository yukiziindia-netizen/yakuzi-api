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

## What is implemented, and what is not

**Phase 1 — complete and real:**
Integrations UI; the full data model; Shopify OAuth; WooCommerce
`/wc-auth/v1/authorize`; Amazon LWA/SP-API; encrypted credential storage;
connection health with an hourly probe; disconnect with remote webhook cleanup;
setup wizard; sync activity log; manual product mapping; signature-verified
webhook receivers with idempotency and loop protection.

**Not yet implemented** (schema and endpoints exist; no job runs them):
bulk product import, automatic SKU matching, inventory pull/push execution,
reconciliation sweeps, and the sync job runner. `POST /:id/sync` enqueues a real
job row that currently has no worker — the UI reports it as queued, which is
accurate.

Two-way sync is deliberately refused by the API
(`supportsTwoWaySync()` returns `false`) until the inventory processor and its
conflict handling exist. Offering it earlier would risk double-deduction.

Price and order sync are marked **Coming soon** in the UI and have columns
reserved (`syncPrices`, `syncOrders`) that no job reads.
