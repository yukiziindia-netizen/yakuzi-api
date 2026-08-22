# AI Chatbot RAG + Training Rebuild — Design

## Problem

The admin "AI Chatbot Management" panel's training feature doesn't do what it appears to do. `POST /train/conversation` and `POST /train/dataset` (in the Python sidecar, `chatbot/main.py`) don't call Gemini's real fine-tuning API — they string-append the raw sandbox transcript onto one giant flat `system_prompt.txt` file that's sent as the system instruction on every `/chat` call, then return a fabricated `job_id` (`CONTEXT_INJECTION_<name>`) and a hardcoded `"status": "SUCCEEDED"`. There's dead code (`monitor_tuning_job`) for polling a *real* Gemini tuning job that's never actually created anywhere — evidence of an earlier, abandoned real-tuning attempt.

This has three concrete problems:
1. **Unbounded growth, no structure.** Every saved conversation appends its full transcript forever. Nothing bounds it, nothing lets an admin see or manage what's actually "known," and there's no way to disable one bad example without clearing everything.
2. **No separation from the base persona.** Training writes into the same file that defines "be a helpful general-purpose assistant, not just a store bot." There's no guarantee a training session can't quietly narrow that down over time.
3. **No real product/blog/review knowledge.** The bot has exactly two tools: a crude `search_products` (name/manufacturer/mrp only, `ILIKE` substring match) and `get_order_status`. Nothing touches blog content or reviews at all.

## Architecture

**Two-layer prompt, not one.**
- **Base persona** (`chatbot/system_prompt.txt`): the fixed "unrestricted general assistant" instruction. Training never writes to this file again — this is what guarantees the bot can't be accidentally narrowed by a training session.
- **Learned rules** (new `ChatbotRule` table, Postgres/Prisma): discrete, admin-reviewed rows — `trigger` (short label), `instruction` (the behavior), `isActive`, timestamps. At chat time the Python sidecar queries `WHERE "isActive" = true ORDER BY "createdAt" DESC LIMIT 100` directly via `psycopg2` (same pattern it already uses for `search_products`/`get_order_status`) and appends them as a compact bullet list under the base prompt. Bounded, readable, and structurally separate from the persona.

**Saving a conversation — two steps, not one silent action:**
1. Admin clicks "Save conversation" → sidecar endpoint `POST /train/extract` sends the sandbox transcript to Gemini once, asking it to distill the instruction being taught into a single concise `{trigger, instruction}` pair. Nothing is persisted by this call — it returns a draft.
2. Admin reviews/edits the draft in a modal, confirms → frontend calls a new NestJS endpoint `POST /admin/chatbot/rules` (plain Prisma write, no sidecar round-trip needed for persistence) which creates the `ChatbotRule` row.

**RAG tools** (Gemini function-calling — the mechanism the bot already uses):
- `search_products(query)` — broadened to return description, category name, stock, and average rating (currently: name/manufacturer/mrp only).
- `search_blogs(query)` — new. Keyword match (`ILIKE`) over `BlogPost.title`/`excerpt`/`tags` where `status = 'PUBLISHED'`. Returns title, excerpt, slug (up to 5 matches).
- `get_product_reviews(productId_or_name)` — new. Average rating + up to 5 most recent `Review.comment` for a product (resolves by id or name match against `CatalogProduct`).

All three query Postgres live at chat time — no embedding pipeline, no reindexing job, no staleness. This matches the existing architecture (the sidecar already holds a live DB connection) and was a deliberate choice over vector/semantic search: keyword tool-calling ships without new infrastructure, and product/blog/review volumes here don't need fuzzy semantic matching to be useful.

## Data model

```prisma
model ChatbotRule {
  id          String   @id @default(uuid())
  trigger     String   // short label, e.g. "best comic recommendation"
  instruction String   // the actual behavior, e.g. "must say kuji kari"
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("chatbot_rules")
}
```

The existing `ChatbotJob` model (`chatbot_jobs` table) is left in place, untouched, as a read-only legacy log — nothing writes to it anymore after this change ships. See "Migration" below for why.

## Sidecar changes (`chatbot/main.py`)

- `POST /train/extract` (new): takes `{history: ChatMessage[]}`, makes one Gemini call with a short meta-prompt asking it to output `{trigger, instruction}` as JSON describing the instruction being taught in the conversation. Returns the draft; does not touch any file or DB.
- `POST /train/conversation`, `POST /train/dataset`, `POST /train/sync` (existing): removed. They implemented the flat-file append model this design replaces. `/train/reset` stays but now just re-reads `DEFAULT_PROMPT` (no rules to clear — that's a NestJS-side delete against `ChatbotRule`).
- `POST /chat` (existing, modified): before calling Gemini, queries `ChatbotRule` for active rules and appends them under the base prompt as `LEARNED RULES:\n- <trigger>: <instruction>\n...`. If the DB query fails, logs a warning and falls back to the base prompt alone — chat still works on general knowledge, it just skips the store-specific rules for that request. Also registers `search_blogs` and `get_product_reviews` alongside the existing tools.
- `search_products`: query broadened (join to category, add stock/description/rating) — same function, richer `SELECT`.

## NestJS changes (`src/modules/chatbot`)

**Pre-existing vulnerability, fixed as part of this work.** The buyer-facing chat widget already does this correctly today — it calls `sendChatMessageFull()` (`packages/api-client/src/modules/chatbot.api.ts`), which hits NestJS's real `POST /chatbot/chat` through the shared authenticated API client. That endpoint is intentionally unguarded (chat is legitimately public/guest-usable), which is fine.

The **admin** panel doesn't use this path at all: `apps/admin/app/chatbot/page.tsx` calls `fetch("/api/chatbot/train/conversation")`, `/api/chatbot/train/prompt`, `/api/chatbot/chat`, etc. — a Next.js catch-all route (`apps/admin/app/api/chatbot/[...path]/route.ts`) that blind-forwards **any** path straight to the Python sidecar with **no auth check at all**. So every admin-only training action is reachable by anyone with the admin domain's URL, no login required.

There's also an identical, entirely unused catch-all proxy sitting in the **buyer** app (`apps/buyer/src/app/api/chatbot/[...path]/route.ts`) — nothing in the buyer app's code calls it (confirmed: no references anywhere in `apps/buyer/src`), but it's still a deployed, reachable route on the public storefront domain. Since it forwards any path, not just `/chat`, anyone can currently `POST yukizi.com/api/chatbot/train/prompt` directly and overwrite the live bot's persona. This is live today, independent of anything else in this spec.

**Fix:**
- Delete `apps/buyer/src/app/api/chatbot/[...path]/route.ts` outright — dead code that's also an open door. Nothing needs to replace it; the real widget already goes through NestJS correctly.
- `apps/admin/app/chatbot/page.tsx` switches from raw `fetch("/api/chatbot/...")` to the same `@yukizi/api-client` functions the buyer widget uses (`sendChatMessageFull` for sandbox chat) plus new client functions for the rules/extract endpoints below — all going through NestJS, which already attaches the admin's JWT the same way every other admin page does. `apps/admin/app/api/chatbot/[...path]/route.ts` is deleted once nothing references it.
- New admin-only NestJS endpoints get `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN)`, matching the guard pattern already used elsewhere (e.g. `storage.controller.ts`). `POST /chatbot/chat` itself stays unguarded — that's correct, existing, intentional behavior for the buyer widget.

**Endpoints:**
- `POST /chatbot/chat` — unguarded (existing, unchanged), now also reused by the admin sandbox instead of the open proxy.
- `GET/POST/PATCH/DELETE /admin/chatbot/rules` — **ADMIN-guarded**, CRUD against `ChatbotRule`, plain Prisma.
- `POST /chatbot/train/extract` — **ADMIN-guarded**, thin proxy to the sidecar's new `/train/extract`.
- Remove: `saveJobStatus`, `getJobStatus`, `getJobHistory`, `deleteJob` (`/chatbot/job-status`, `/chatbot/job-history*`) and the `SystemSetting` keys they used (`chatbot_job_id`, `chatbot_job_status`) — these existed to track the fake job IDs and are no longer meaningful. `resetSidecarMemory`/`syncSidecarMemory` helpers go too (no more flat-file sync).
- `ChatbotService.syncTrainingFromDatabase()` (called on module boot): removed — there's no flat-file state to resync into the sidecar on restart anymore; rules live in Postgres and the sidecar reads them fresh on every `/chat` call.

## Admin frontend changes (`apps/admin/app/chatbot/page.tsx`)

- All `fetch("/api/chatbot/...")` calls switch to `@yukizi/api-client`/NestJS calls (see above) instead of the raw Next.js proxy.
- Sandbox chat UI: unchanged in appearance (send message, view response, thinking-process disclosure) — now calls `POST /chatbot/chat` through the shared API client instead of the open proxy.
- "Train on Conversation" button → **"Save conversation"**: now opens a confirmation modal showing the extracted `{trigger, instruction}` draft (both fields editable) before persisting, instead of silently firing off a fake tuning job.
- "Training History" table → **Rules list**: trigger, instruction, active toggle, delete — replaces the job-ID/status table, which no longer has anything real to show.
- The "Last Job ID: SUCCEEDED / CONTEXT_INJECTION_..." banner is removed entirely.
- "Clear All & Reset Memory" → deactivates/deletes all rules (same user-facing effect, honest about what it's doing).

## Buyer frontend change (`apps/buyer/src/app/api/chatbot`)

`[...path]/route.ts` is deleted. It's unreferenced dead code (see above) — the real chat widget already calls NestJS directly via `@yukizi/api-client`, not this proxy.

## Migration

The one already-injected example currently baked into `system_prompt.txt` ("when asked about best comic, say kuji kari") is not auto-migrated. On deploy, the base prompt resets to `DEFAULT_PROMPT`. If that specific example is worth keeping, it's a 10-second re-teach through the new sandbox → Save flow. `ChatbotJob` rows (including this one) remain readable in the DB as a legacy log but aren't surfaced in a UI that implies they're still active.

## Scope cuts (deliberate, confirmed with Rishi)

- **Dataset file upload** (`/train/dataset`, the jsonl upload UI) is dropped. It doesn't fit the rule model (no admin review/edit step) and wasn't part of the ask.
- **No vector/semantic search** — keyword `ILIKE` tool calls only, per above.
- **No automatic migration** of the one existing training example.

## Error handling

- `/train/extract` failing (Gemini unavailable, malformed response): admin can type the trigger/instruction manually in the modal instead — never blocks saving a rule.
- `ChatbotRule` query failing inside `/chat`: falls back to base-prompt-only, logs a warning, chat still responds.
- `search_blogs`/`get_product_reviews` DB errors: same pattern already used by `search_products` — return an `"Error: ..."` string the model can see and route around, not an exception that kills the whole chat turn.

## Testing

- **Python (pytest, extending `test_chat.py`/`test_train.py`):** `/train/extract` returns a well-formed draft from a sample transcript; `/chat` includes active rules in the assembled system instruction and excludes inactive ones; `/chat` degrades gracefully when the rules query throws; `search_blogs` only returns `PUBLISHED` posts; `get_product_reviews` resolves by id and by name.
- **NestJS (Jest):** rules CRUD (create/list/toggle/delete) against a mocked Prisma client, matching existing service test conventions in this repo; a guard test confirming `/admin/chatbot/rules/*` and `/chatbot/train/extract` reject unauthenticated and non-admin callers (401/403), and that `/chatbot/chat` still accepts unauthenticated requests (no regression on the buyer widget).
- **Frontend:** no automated tests (none exist elsewhere in this admin app) — `tsc --noEmit` + `next build` clean, plus a manual verification checklist in the PR description, matching every other session's approach on this project.

## Out of scope (this spec)

- AI chat analytics dashboard (topic/mood/gender breakdown) — separate sub-project, not started.
- Search analytics dashboard — separate sub-project, not started.
- Any change to the buyer-facing chat widget UI itself.
