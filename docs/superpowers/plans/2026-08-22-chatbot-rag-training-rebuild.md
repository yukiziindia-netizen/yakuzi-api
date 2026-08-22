# AI Chatbot RAG + Training Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI chatbot's fake "training" (flat-text prompt concatenation, fabricated job IDs) with a two-layer prompt (fixed base persona + structured, admin-reviewed `ChatbotRule` rows), add real database-backed RAG tools for blogs and reviews alongside a broadened product search, and close an unauthenticated write path into the chatbot sidecar reachable from both the admin and public buyer domains.

**Architecture:** The Python FastAPI sidecar (`chatbot/main.py`, already spawned as a child process by the NestJS API on boot) keeps owning the actual Gemini calls and gets three changes: a new `/train/extract` endpoint that distills a sandbox conversation into a `{trigger, instruction}` draft via one Gemini call, a `build_system_instruction()` helper that appends active `ChatbotRule` rows (read live from Postgres) under the untouched base prompt, and two new DB-backed tool functions (`search_blogs`, `get_product_reviews`) alongside a broadened `search_products`. NestJS gets a new admin-guarded `ChatbotRule` CRUD module and a guarded proxy for `/train/extract`; its existing `POST /chatbot/chat` (already used correctly by the buyer widget) stays public. The admin frontend switches from an unauthenticated raw fetch proxy to these real, guarded endpoints; the identical unused proxy in the buyer app is deleted outright.

**Tech Stack:** NestJS + Prisma + Postgres (`yakuzi-api`), FastAPI + psycopg2 + google-genai (Python sidecar), Next.js + React Query (`yakuzi-web` admin app).

**Two-repo plan, API-first.** Tasks 1–11 are in `yakuzi-api`; Tasks 12–15 are in `yakuzi-web`. The web tasks depend on the API endpoints existing, so do them in order.

---

## Reference: exact table/column names used below

Confirmed by reading `prisma/schema.prisma` directly — raw SQL in the Python sidecar bypasses Prisma's client entirely, so these must be exact:

- `catalog_products` (model `CatalogProduct`): `id`, `name`, `manufacturer`, `mrp`, `description`, `"categoryId"`, `"isActive"`, `"deletedAt"` — all `id`-style columns are plain `String`/`TEXT` (no `@db.Uuid`), so comparing them to an arbitrary string never throws a type error.
- `categories` (model `Category`): `id`, `name`.
- `seller_offers` (model `SellerOffer`): `id`, `"catalogProductId"`, `"isActive"`, `"approvalStatus"` (enum `ProductApprovalStatus`, includes `APPROVED`).
- `product_batches` (model `ProductBatch`): `id`, `"sellerOfferId"`, `stock` (Int), `"expiryDate"`.
- `reviews` (model `Review`): `id`, `"catalogProductId"`, `rating` (Int), `comment` (String?), `"createdAt"`.
- `blog_posts` (model `BlogPost`): `id`, `title`, `slug`, `excerpt`, `tags` (String[]), `status` (enum `BlogStatus`: `DRAFT` | `PUBLISHED`), `"publishedAt"`.
- New table this plan adds: `chatbot_rules` (model `ChatbotRule`).

---

# Part A — `yakuzi-api`

### Task 1: `ChatbotRule` Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model**

Add this immediately after the existing `ChatbotJob` model (currently at line 945-954 of `prisma/schema.prisma`):

```prisma
model ChatbotRule {
  id          String   @id @default(uuid())
  trigger     String
  instruction String
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("chatbot_rules")
}
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_chatbot_rule`
Expected: creates a new folder under `prisma/migrations/` containing a `migration.sql` with a `CREATE TABLE "chatbot_rules" (...)` statement, and regenerates the Prisma client. Confirm the migration applied cleanly (command exits 0, no error about drift).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add ChatbotRule model for structured chatbot training"
```

---

### Task 2: Python sidecar — pytest infrastructure

The two existing files named like tests (`chatbot/test_chat.py`, `chatbot/test_train.py`) are manual smoke scripts that hit a live running server with `requests` and print output — there is no real automated test suite for this service today. This task establishes one from scratch.

**Files:**
- Modify: `chatbot/requirements.txt`
- Create: `chatbot/conftest.py`
- Create: `chatbot/test_health.py`

- [ ] **Step 1: Add test dependencies**

Add a new group at the end of `chatbot/requirements.txt`:

```
pytest>=8.0.0
httpx>=0.27.0
```

(`httpx` is required by FastAPI's `TestClient` in the version of Starlette this project uses.)

- [ ] **Step 2: Add conftest.py so `main` is importable**

`chatbot/` has no `__init__.py` — it's a flat script directory, not a package. Create `chatbot/conftest.py`:

```python
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
```

- [ ] **Step 3: Write a trivial smoke test to prove the harness works**

Create `chatbot/test_health.py`:

```python
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health_check_returns_200():
    response = client.get("/health")
    assert response.status_code == 200
    assert "status" in response.json()
```

- [ ] **Step 4: Install deps and run it**

```bash
cd chatbot
pip install -r requirements.txt
pytest test_health.py -v
```

Expected: `test_health_check_returns_200 PASSED`.

- [ ] **Step 5: Commit**

```bash
git add chatbot/requirements.txt chatbot/conftest.py chatbot/test_health.py
git commit -m "test: add pytest infrastructure for the chatbot sidecar"
```

---

### Task 3: Python sidecar — `get_active_rules()` + `build_system_instruction()`

**Files:**
- Modify: `chatbot/main.py`
- Create: `chatbot/test_rules.py`

- [ ] **Step 1: Write the failing tests**

Create `chatbot/test_rules.py`:

```python
from unittest.mock import MagicMock, patch

from main import build_system_instruction, DEFAULT_PROMPT, get_active_rules


def _mock_conn_returning(rows):
    """Builds a mock psycopg2 connection whose cursor context manager
    returns `rows` from fetchall()."""
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = rows
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    return mock_conn, mock_cursor


def test_get_active_rules_queries_only_active_rows_ordered_and_capped():
    mock_conn, mock_cursor = _mock_conn_returning(
        [{"trigger": "best comic", "instruction": "say kuji kari"}]
    )
    with patch("main.get_db_connection", return_value=mock_conn):
        rules = get_active_rules()

    assert rules == [{"trigger": "best comic", "instruction": "say kuji kari"}]
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert '"isActive" = true' in executed_sql
    assert "LIMIT 100" in executed_sql


def test_get_active_rules_returns_empty_list_when_db_unavailable():
    with patch("main.get_db_connection", return_value=None):
        assert get_active_rules() == []


def test_get_active_rules_returns_empty_list_on_query_error():
    mock_conn = MagicMock()
    mock_conn.cursor.side_effect = Exception("connection reset")
    with patch("main.get_db_connection", return_value=mock_conn):
        assert get_active_rules() == []


def test_build_system_instruction_appends_rules_under_base_prompt():
    rules = [{"trigger": "best comic", "instruction": "say kuji kari"}]
    with patch("main.get_active_rules", return_value=rules):
        instruction = build_system_instruction()

    assert instruction.startswith(DEFAULT_PROMPT.split("\n")[0][:20])
    assert "best comic: say kuji kari" in instruction


def test_build_system_instruction_falls_back_to_base_prompt_when_no_rules():
    with patch("main.get_active_rules", return_value=[]):
        instruction = build_system_instruction()

    assert "LEARNED RULES" not in instruction
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd chatbot && pytest test_rules.py -v`
Expected: `ImportError` / `AttributeError` — `build_system_instruction` and `get_active_rules` don't exist yet.

- [ ] **Step 3: Implement**

In `chatbot/main.py`, add these two functions immediately after the existing `get_order_status` function (currently ending around line 173, right before the `BACKGROUND TUNING MONITOR` section header):

```python
# ==========================================
# LEARNED RULES (structured training)
# ==========================================
def get_active_rules() -> list:
    """Reads active ChatbotRule rows fresh on every call — no caching, so an
    admin toggling a rule off takes effect on the very next chat message."""
    conn = get_db_connection()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                'SELECT trigger, instruction FROM chatbot_rules '
                'WHERE "isActive" = true ORDER BY "createdAt" DESC LIMIT 100'
            )
            return cur.fetchall()
    except Exception as e:
        print(f"Error fetching chatbot rules: {e}", file=sys.stderr)
        return []
    finally:
        conn.close()


def build_system_instruction() -> str:
    """Base persona (never modified by training) plus a bounded, structured
    list of admin-taught rules — replaces the old model of appending raw
    conversation transcripts directly into system_prompt.txt forever."""
    base = load_text_file(PROMPT_FILE, DEFAULT_PROMPT)
    rules = get_active_rules()
    if not rules:
        return base
    rules_block = "\n\nLEARNED RULES (store-specific behavior taught by an admin):\n" + "\n".join(
        f"- {r['trigger']}: {r['instruction']}" for r in rules
    )
    return base + rules_block
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd chatbot && pytest test_rules.py -v`
Expected: all 5 tests PASS.

- [ ] **Step 5: Wire it into `/chat`**

In `chatbot/main.py`, inside the `chat()` endpoint function, find this line (currently in the `config = types.GenerateContentConfig(...)` block):

```python
            system_instruction=load_text_file(PROMPT_FILE, DEFAULT_PROMPT),
```

Replace it with:

```python
            system_instruction=build_system_instruction(),
```

- [ ] **Step 6: Commit**

```bash
git add chatbot/main.py chatbot/test_rules.py
git commit -m "feat: inject active ChatbotRule rows into the chat system instruction"
```

---

### Task 4: Python sidecar — broaden `search_products`

**Files:**
- Modify: `chatbot/main.py`
- Create: `chatbot/test_tools.py`

- [ ] **Step 1: Write the failing test**

Create `chatbot/test_tools.py`:

```python
from unittest.mock import MagicMock, patch

from main import search_products


def _mock_conn_returning(rows):
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = rows
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    return mock_conn, mock_cursor


def test_search_products_queries_description_category_stock_and_rating():
    rows = [{
        "name": "Naruto Vol. 1", "manufacturer": "Viz Media", "mrp": 499,
        "description": "First volume", "category": "Books",
        "stock": 12, "avg_rating": 4.5,
    }]
    mock_conn, mock_cursor = _mock_conn_returning(rows)
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_products("naruto")

    assert "Naruto Vol. 1" in result
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "description" in executed_sql
    assert "stock" in executed_sql.lower()
    assert "avg_rating" in executed_sql
    params = mock_cursor.execute.call_args[0][1]
    assert params == ("%naruto%", "%naruto%", "%naruto%")


def test_search_products_returns_no_results_message_when_empty():
    mock_conn, _ = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_products("nonexistent")
    assert "No products found" in result
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd chatbot && pytest test_tools.py -v`
Expected: FAIL — current `search_products` doesn't select `description`/`stock`/`avg_rating`, so the assertions on `executed_sql` fail.

- [ ] **Step 3: Implement**

In `chatbot/main.py`, replace the entire body of `search_products` (currently lines ~140-157):

```python
def search_products(query: str) -> str:
    """Searches the database for products matching the query, including
    description, category, live stock across active/approved seller offers,
    and average review rating."""
    conn = get_db_connection()
    if not conn: return "Error: Could not connect to database."
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                'SELECT cp.name, cp.manufacturer, cp.mrp, cp.description, '
                'c.name AS category, '
                'COALESCE(('
                '  SELECT SUM(pb.stock) FROM product_batches pb '
                '  JOIN seller_offers so ON so.id = pb."sellerOfferId" '
                '  WHERE so."catalogProductId" = cp.id AND so."isActive" = true '
                '  AND so."approvalStatus" = \'APPROVED\' AND pb."expiryDate" > NOW()'
                '), 0) AS stock, '
                'COALESCE(('
                '  SELECT ROUND(AVG(r.rating)::numeric, 1) FROM reviews r '
                '  WHERE r."catalogProductId" = cp.id'
                '), 0) AS avg_rating '
                'FROM catalog_products cp '
                'JOIN categories c ON c.id = cp."categoryId" '
                'WHERE (cp.name ILIKE %s OR cp.manufacturer ILIKE %s OR cp.description ILIKE %s) '
                'AND cp."isActive" = true AND cp."deletedAt" IS NULL LIMIT 5',
                (f"%{query}%", f"%{query}%", f"%{query}%")
            )
            rows = cur.fetchall()
            return str(rows) if rows else f"No products found matching '{query}'."
    except Exception as e:
        return f"Error executing query: {str(e)}"
    finally:
        conn.close()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd chatbot && pytest test_tools.py -v`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add chatbot/main.py chatbot/test_tools.py
git commit -m "feat: broaden search_products with description, category, stock, rating"
```

---

### Task 5: Python sidecar — `search_blogs` tool

**Files:**
- Modify: `chatbot/main.py`
- Modify: `chatbot/test_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `chatbot/test_tools.py`:

```python
from main import search_blogs


def test_search_blogs_only_queries_published_posts():
    mock_conn, mock_cursor = _mock_conn_returning(
        [{"title": "Top 5 Manga of 2026", "excerpt": "...", "slug": "top-5-manga-2026"}]
    )
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_blogs("manga")

    assert "Top 5 Manga" in result
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "'PUBLISHED'" in executed_sql


def test_search_blogs_returns_no_results_message_when_empty():
    mock_conn, _ = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_blogs("nonexistent")
    assert "No blog posts found" in result
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd chatbot && pytest test_tools.py -v`
Expected: FAIL — `ImportError: cannot import name 'search_blogs'`.

- [ ] **Step 3: Implement**

In `chatbot/main.py`, add this function directly after `search_products`:

```python
def search_blogs(query: str) -> str:
    """Searches published blog posts by title, excerpt, or tag."""
    conn = get_db_connection()
    if not conn: return "Error: Could not connect to database."
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                'SELECT title, excerpt, slug FROM blog_posts '
                'WHERE status = \'PUBLISHED\' '
                'AND (title ILIKE %s OR excerpt ILIKE %s OR %s = ANY(tags)) '
                'ORDER BY "publishedAt" DESC LIMIT 5',
                (f"%{query}%", f"%{query}%", query)
            )
            rows = cur.fetchall()
            return str(rows) if rows else f"No blog posts found matching '{query}'."
    except Exception as e:
        return f"Error executing query: {str(e)}"
    finally:
        conn.close()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd chatbot && pytest test_tools.py -v`
Expected: all 4 tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add chatbot/main.py chatbot/test_tools.py
git commit -m "feat: add search_blogs RAG tool for the chatbot"
```

---

### Task 6: Python sidecar — `get_product_reviews` tool

**Files:**
- Modify: `chatbot/main.py`
- Modify: `chatbot/test_tools.py`

- [ ] **Step 1: Write the failing tests**

Append to `chatbot/test_tools.py`:

```python
from main import get_product_reviews


def test_get_product_reviews_resolves_by_id():
    mock_cursor = MagicMock()
    mock_cursor.fetchone.side_effect = [
        {"id": "prod-123"},
        {"avg_rating": 4.5, "review_count": 2},
    ]
    mock_cursor.fetchall.return_value = [
        {"rating": 5, "comment": "Great quality"},
        {"rating": 4, "comment": "Good value"},
    ]
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    with patch("main.get_db_connection", return_value=mock_conn):
        result = get_product_reviews("prod-123")

    assert "4.5/5" in result
    assert "Great quality" in result
    lookup_sql = mock_cursor.execute.call_args_list[0][0][0]
    assert "name ILIKE" in lookup_sql
    assert "id = %s" in lookup_sql


def test_get_product_reviews_resolves_by_name():
    mock_cursor = MagicMock()
    mock_cursor.fetchone.side_effect = [
        {"id": "prod-456"},
        {"avg_rating": 3.0, "review_count": 1},
    ]
    mock_cursor.fetchall.return_value = [{"rating": 3, "comment": "It's okay"}]
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    with patch("main.get_db_connection", return_value=mock_conn):
        result = get_product_reviews("Naruto Vol. 1")

    assert "3.0/5" in result


def test_get_product_reviews_no_product_found():
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = None
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    with patch("main.get_db_connection", return_value=mock_conn):
        result = get_product_reviews("nonexistent")

    assert "No product found" in result


def test_get_product_reviews_no_reviews_yet():
    mock_cursor = MagicMock()
    mock_cursor.fetchone.side_effect = [
        {"id": "prod-789"},
        {"avg_rating": None, "review_count": 0},
    ]
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    with patch("main.get_db_connection", return_value=mock_conn):
        result = get_product_reviews("prod-789")

    assert "No reviews yet" in result
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd chatbot && pytest test_tools.py -v`
Expected: FAIL — `ImportError: cannot import name 'get_product_reviews'`.

- [ ] **Step 3: Implement**

In `chatbot/main.py`, add this function directly after `search_blogs`:

```python
def get_product_reviews(product_identifier: str) -> str:
    """Looks up a product by id or name, then returns its average rating
    and a handful of recent review comments."""
    conn = get_db_connection()
    if not conn: return "Error: Could not connect to database."
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                'SELECT id FROM catalog_products '
                'WHERE (id = %s OR name ILIKE %s) AND "isActive" = true AND "deletedAt" IS NULL '
                'LIMIT 1',
                (product_identifier, f"%{product_identifier}%")
            )
            product = cur.fetchone()
            if not product:
                return f"No product found matching '{product_identifier}'."

            cur.execute(
                'SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating, COUNT(*) AS review_count '
                'FROM reviews WHERE "catalogProductId" = %s',
                (product['id'],)
            )
            summary = cur.fetchone()
            if not summary or not summary['review_count']:
                return "No reviews yet for this product."

            cur.execute(
                'SELECT rating, comment FROM reviews WHERE "catalogProductId" = %s '
                'AND comment IS NOT NULL ORDER BY "createdAt" DESC LIMIT 5',
                (product['id'],)
            )
            recent = cur.fetchall()

            lines = [f"Average rating: {summary['avg_rating']}/5 from {summary['review_count']} review(s)."]
            for r in recent:
                lines.append(f"- {r['rating']}/5: {r['comment']}")
            return "\n".join(lines)
    except Exception as e:
        return f"Error executing query: {str(e)}"
    finally:
        conn.close()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd chatbot && pytest test_tools.py -v`
Expected: all 8 tests in the file PASS.

- [ ] **Step 5: Register both new tools in `/chat`**

In `chatbot/main.py`, find this line inside the `chat()` endpoint:

```python
            tools=[search_products, get_order_status],
```

Replace with:

```python
            tools=[search_products, get_order_status, search_blogs, get_product_reviews],
```

- [ ] **Step 6: Commit**

```bash
git add chatbot/main.py chatbot/test_tools.py
git commit -m "feat: add get_product_reviews RAG tool, register both new tools in chat"
```

---

### Task 7: Python sidecar — `/train/extract` endpoint

**Files:**
- Modify: `chatbot/main.py`
- Create: `chatbot/test_extract.py`

- [ ] **Step 1: Write the failing tests**

Create `chatbot/test_extract.py`:

```python
import json
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

SAMPLE_HISTORY = [
    {"role": "user", "content": "when user ask best comic you must say kuji kari"},
    {"role": "assistant", "content": "Understood! I'll respond with 'kuji kari'."},
]


def test_extract_returns_trigger_and_instruction_from_transcript():
    mock_response = MagicMock()
    mock_response.text = json.dumps({
        "trigger": "best comic recommendation",
        "instruction": "must say kuji kari",
    })
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = mock_response

    with patch("main.HAS_GEMINI", True), \
         patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}), \
         patch("main.get_genai_client", return_value=mock_client):
        response = client.post("/train/extract", json={"history": SAMPLE_HISTORY})

    assert response.status_code == 200
    body = response.json()
    assert body["trigger"] == "best comic recommendation"
    assert body["instruction"] == "must say kuji kari"


def test_extract_rejects_short_history():
    response = client.post("/train/extract", json={"history": [SAMPLE_HISTORY[0]]})
    assert response.status_code == 400


def test_extract_fails_cleanly_when_gemini_unavailable():
    with patch("main.HAS_GEMINI", False):
        response = client.post("/train/extract", json={"history": SAMPLE_HISTORY})
    assert response.status_code == 500


def test_extract_fails_cleanly_on_malformed_gemini_response():
    mock_response = MagicMock()
    mock_response.text = "not valid json"
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = mock_response

    with patch("main.HAS_GEMINI", True), \
         patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}), \
         patch("main.get_genai_client", return_value=mock_client):
        response = client.post("/train/extract", json={"history": SAMPLE_HISTORY})

    assert response.status_code == 500
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd chatbot && pytest test_extract.py -v`
Expected: FAIL with 404s — `/train/extract` doesn't exist yet.

- [ ] **Step 3: Implement**

In `chatbot/main.py`, add this endpoint directly after the `train_conversation` endpoint (which Task 9 will delete — for now, add this new one right after it so the diff is easy to review):

```python
@app.post("/train/extract")
def extract_rule(req: ConversationTrainRequest):
    """Distills the instruction an admin just taught in a sandbox conversation
    into a short {trigger, instruction} pair. Does not persist anything —
    the caller (NestJS) shows this as an editable draft before saving."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not HAS_GEMINI or not api_key:
        raise HTTPException(status_code=500, detail="Gemini SDK/API Key not configured.")
    if len(req.history) < 2:
        raise HTTPException(status_code=400, detail="Not enough conversation history to extract a rule from.")

    transcript = "\n".join(f"{m.role}: {m.content}" for m in req.history if m.content)
    extraction_prompt = (
        "An admin just taught a customer-service chatbot a new behavior through this "
        "conversation. Distill the single instruction being taught into a short JSON "
        "object with two fields: \"trigger\" (a few words describing when this applies) "
        "and \"instruction\" (the exact behavior to follow, as an imperative sentence). "
        "Respond with ONLY the JSON object, no other text.\n\n"
        f"Conversation:\n{transcript}"
    )
    try:
        client = get_genai_client(api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=extraction_prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        parsed = json.loads(response.text)
        trigger = str(parsed.get("trigger", "")).strip()
        instruction = str(parsed.get("instruction", "")).strip()
        if not trigger or not instruction:
            raise ValueError("Gemini returned an incomplete rule")
        return {"trigger": trigger, "instruction": instruction}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract rule: {str(e)}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd chatbot && pytest test_extract.py -v`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add chatbot/main.py chatbot/test_extract.py
git commit -m "feat: add /train/extract endpoint to distill sandbox conversations into rules"
```

---

### Task 8: Python sidecar — remove the flat-file training endpoints

**Files:**
- Modify: `chatbot/main.py`
- Delete: `chatbot/test_train.py`
- Delete: `chatbot/test_chat.py`

- [ ] **Step 1: Delete the dead endpoints**

In `chatbot/main.py`, delete these in full:
- The `train_conversation` endpoint (`@app.post("/train/conversation")` and its function body).
- The `upload_dataset` endpoint (`@app.post("/train/dataset")` and its function body).
- The `sync_training_memory` endpoint (`@app.post("/train/sync")` and its function body).
- The `SyncTrainingRequest` pydantic model.
- The entire `BACKGROUND TUNING MONITOR` section: the `monitor_tuning_job` async function and its section header comment (dead code — nothing calls it; there's no real tuning job for it to poll).
- The `check_tuning_status` endpoint (`@app.get("/train/status/{job_id}")`) — it queried real Gemini tuning job status, but nothing creates real tuning jobs anymore, so it has no valid input to ever receive.

- [ ] **Step 2: Simplify `/train/reset`**

Replace the `reset_training_memory` endpoint body — it already does the right thing (resets to `DEFAULT_PROMPT`), no change needed there. Just confirm it's still present after the deletions above; it should be untouched.

- [ ] **Step 3: Remove now-unused imports**

Check the top of `chatbot/main.py` — `BackgroundTasks`, `UploadFile`, `File`, `Form` were only used by the deleted `upload_dataset`/`train_conversation` endpoints' signatures (`train_conversation` didn't use them, but `upload_dataset` did — `UploadFile`, `File`, `Form`, `BackgroundTasks`). Remove any of these from the `from fastapi import ...` line that are no longer referenced anywhere else in the file. Run a search first to confirm: `grep -n "BackgroundTasks\|UploadFile\|File(\|Form(" chatbot/main.py` — remove only the ones with zero remaining matches outside the import line itself.

- [ ] **Step 4: Delete the manual smoke-test scripts**

These two files are the old non-pytest smoke scripts and exercise endpoints that no longer exist (`/train/prompt` update + grumpy-persona test in `test_train.py` — actually `/train/prompt` still exists and is unrelated to this cleanup, but both files predate the pytest suite added in Task 2 and duplicate what `test_rules.py`/`test_tools.py`/`test_extract.py`/`test_health.py` now cover properly):

```bash
git rm chatbot/test_train.py chatbot/test_chat.py
```

- [ ] **Step 5: Verify the app still boots and the real test suite passes**

```bash
cd chatbot
python -c "from main import app; print('OK')"
pytest -v
```

Expected: `OK` printed, then all tests across `test_health.py`, `test_rules.py`, `test_tools.py`, `test_extract.py` PASS (this also catches any leftover reference to a deleted function/model).

- [ ] **Step 6: Commit**

```bash
git add chatbot/main.py
git commit -m "refactor: remove fake flat-file training endpoints and dead tuning-poll code"
```

---

### Task 9: NestJS — `ChatbotRulesService` + DTOs (TDD)

**Files:**
- Create: `src/modules/chatbot/chatbot-rules.dto.ts`
- Create: `src/modules/chatbot/chatbot-rules.service.ts`
- Create: `src/modules/chatbot/chatbot-rules.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/chatbot/chatbot-rules.service.spec.ts`:

```typescript
import { ChatbotRulesService } from './chatbot-rules.service';

const buildRule = (over: Partial<any> = {}) => ({
  id: 'rule-1',
  trigger: 'best comic recommendation',
  instruction: 'must say kuji kari',
  isActive: true,
  createdAt: new Date('2026-08-22T00:00:00Z'),
  updatedAt: new Date('2026-08-22T00:00:00Z'),
  ...over,
});

const build = () => {
  const prisma = {
    chatbotRule: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const service = new ChatbotRulesService(prisma as never);
  return { service, prisma };
};

describe('ChatbotRulesService', () => {
  it('creates a rule from trigger/instruction', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.create.mockResolvedValue(buildRule());

    await service.create({ trigger: 'best comic recommendation', instruction: 'must say kuji kari' });

    expect(prisma.chatbotRule.create).toHaveBeenCalledWith({
      data: { trigger: 'best comic recommendation', instruction: 'must say kuji kari' },
    });
  });

  it('lists rules most-recent first', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.findMany.mockResolvedValue([buildRule()]);

    const result = await service.list();

    expect(prisma.chatbotRule.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
    expect(result).toEqual([buildRule()]);
  });

  it('toggles isActive via update', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.update.mockResolvedValue(buildRule({ isActive: false }));

    await service.update('rule-1', { isActive: false });

    expect(prisma.chatbotRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-1' },
      data: { isActive: false },
    });
  });

  it('edits trigger and instruction via update', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.update.mockResolvedValue(buildRule({ trigger: 'updated trigger' }));

    await service.update('rule-1', { trigger: 'updated trigger' });

    expect(prisma.chatbotRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-1' },
      data: { trigger: 'updated trigger' },
    });
  });

  it('deletes a rule by id', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.delete.mockResolvedValue(buildRule());

    await service.delete('rule-1');

    expect(prisma.chatbotRule.delete).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- chatbot-rules.service.spec.ts`
Expected: FAIL — `Cannot find module './chatbot-rules.service'`.

- [ ] **Step 3: Write the DTOs**

Create `src/modules/chatbot/chatbot-rules.dto.ts`:

```typescript
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateChatbotRuleDto {
  @IsString()
  @IsNotEmpty()
  trigger!: string;

  @IsString()
  @IsNotEmpty()
  instruction!: string;
}

export class UpdateChatbotRuleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  trigger?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  instruction?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

- [ ] **Step 4: Implement the service**

Create `src/modules/chatbot/chatbot-rules.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateChatbotRuleDto, UpdateChatbotRuleDto } from './chatbot-rules.dto';

@Injectable()
export class ChatbotRulesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateChatbotRuleDto) {
    return this.prisma.chatbotRule.create({
      data: { trigger: dto.trigger, instruction: dto.instruction },
    });
  }

  list() {
    return this.prisma.chatbotRule.findMany({ orderBy: { createdAt: 'desc' } });
  }

  update(id: string, dto: UpdateChatbotRuleDto) {
    return this.prisma.chatbotRule.update({
      where: { id },
      data: dto,
    });
  }

  delete(id: string) {
    return this.prisma.chatbotRule.delete({ where: { id } });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- chatbot-rules.service.spec.ts`
Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/chatbot/chatbot-rules.dto.ts src/modules/chatbot/chatbot-rules.service.ts src/modules/chatbot/chatbot-rules.service.spec.ts
git commit -m "feat: add ChatbotRulesService with CRUD against ChatbotRule"
```

---

### Task 10: NestJS — `AdminChatbotRulesController` (guarded) + wire into module

**Files:**
- Create: `src/modules/chatbot/chatbot-rules.controller.ts`
- Modify: `src/modules/chatbot/chatbot.module.ts`

- [ ] **Step 1: Implement the controller**

Create `src/modules/chatbot/chatbot-rules.controller.ts`, modeled directly on `src/modules/seo/seo-admin.controller.ts`'s guard/response-wrapping pattern:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChatbotRulesService } from './chatbot-rules.service';
import { CreateChatbotRuleDto, UpdateChatbotRuleDto } from './chatbot-rules.dto';

@Controller('admin/chatbot/rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ChatbotRulesController {
  constructor(private readonly rulesService: ChatbotRulesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    const data = await this.rulesService.list();
    return { message: 'Chatbot rules retrieved successfully', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateChatbotRuleDto) {
    const data = await this.rulesService.create(dto);
    return { message: 'Chatbot rule created successfully', data };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateChatbotRuleDto) {
    const data = await this.rulesService.update(id, dto);
    return { message: 'Chatbot rule updated successfully', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.rulesService.delete(id);
    return { message: 'Chatbot rule deleted successfully' };
  }
}
```

- [ ] **Step 2: Wire into the module**

Modify `src/modules/chatbot/chatbot.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ChatbotRulesController } from './chatbot-rules.controller';
import { ChatbotRulesService } from './chatbot-rules.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [ChatbotController, ChatbotRulesController],
  providers: [ChatbotService, ChatbotRulesService],
  exports: [ChatbotService],
})
export class ChatbotModule {}
```

- [ ] **Step 3: Build to confirm it compiles and wires up cleanly**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/chatbot/chatbot-rules.controller.ts src/modules/chatbot/chatbot.module.ts
git commit -m "feat: wire ChatbotRulesController into the chatbot module, ADMIN-guarded"
```

---

### Task 11: NestJS — `/chatbot/train/extract` proxy, remove job-history endpoints, remove sync-on-boot

**Files:**
- Modify: `src/modules/chatbot/chatbot.controller.ts`
- Modify: `src/modules/chatbot/chatbot.service.ts`

- [ ] **Step 1: Add the guarded extract proxy**

In `src/modules/chatbot/chatbot.controller.ts`, add these imports at the top (alongside the existing ones):

```typescript
import { UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
```

Add this new method to the `ChatbotController` class, next to the existing `trainConversation` method (which the next step removes):

```typescript
  @Post('train/extract')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Extract a {trigger, instruction} draft from a sandbox conversation' })
  async trainExtract(@Body() dto: { history: any[] }) {
    try {
      const response = await axios.post(`${this.getSidecarUrl()}/train/extract`, dto);
      return response.data;
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `Python sidecar error: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new Error(
        `Failed to communicate with Python sidecar: ${error.message}`,
      );
    }
  }
```

- [ ] **Step 2: Remove the fake-training and job-history endpoints**

In `src/modules/chatbot/chatbot.controller.ts`, delete these methods entirely:
- `saveJobStatus` (`@Post('job-status')`)
- `getJobStatus` (`@Get('job-status')`)
- `getJobHistory` (`@Get('job-history')`)
- `deleteJob` (`@Delete('job-history/:id')`)
- `clearJobHistory` (`@Delete('job-history')`)
- `resetTraining` (`@Post('train/reset')`) — the sidecar's `/train/reset` still exists (Task 8 kept it), but nothing in the new admin frontend needs a NestJS-level proxy for it; the rules list's "delete all" action (Task 13) calls the new rules `DELETE` endpoints directly instead.
- `trainConversation` (`@Post('train/conversation')`) — replaced by `trainExtract` above; the sidecar's own `/train/conversation` no longer exists after Task 8.
- The two private helpers `getSidecarUrl`... **keep this one**, `trainExtract` above uses it — only remove `resetSidecarMemory` and `syncSidecarMemory`, which existed purely to keep the sidecar's flat file in sync with `ChatbotJob` rows.

After these removals, the file's imports of `Get`, `Delete`, `Param` from `@nestjs/common` may become unused — check with `grep -n "@Get(\|@Delete(\|@Param(" src/modules/chatbot/chatbot.controller.ts` and remove any import with zero remaining usages.

- [ ] **Step 3: Remove sync-on-boot from the service**

In `src/modules/chatbot/chatbot.service.ts`:
- Delete the `syncTrainingFromDatabase` method entirely.
- In `onModuleInit()`, remove both calls to `await this.syncTrainingFromDatabase();` (one in the "already healthy" early-return branch, one in the `setTimeout` callback after a fresh launch) — leave the rest of `onModuleInit()`'s health-check/launch logic untouched.
- The `axios` import stays (still used by `sendMessage`).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `axios` in `chatbot.controller.ts` shows as unused after removing `trainConversation`, confirm it's still used by the new `trainExtract` method (it is) — this should not trigger.

- [ ] **Step 5: Manual guard verification** (this codebase has no e2e HTTP test suite for guards — matching that convention rather than introducing a new test style for one endpoint)

With the API running locally:
```bash
curl -i -X POST http://localhost:3000/admin/chatbot/rules -H "Content-Type: application/json" -d '{"trigger":"x","instruction":"y"}'
```
Expected: `401 Unauthorized` (no token). Then repeat with a valid non-admin JWT: expect `403 Forbidden`. Then with a valid admin JWT: expect `201 Created`. Note the confirmed behavior in the PR description.

- [ ] **Step 6: Commit**

```bash
git add src/modules/chatbot/chatbot.controller.ts src/modules/chatbot/chatbot.service.ts
git commit -m "feat: add guarded /chatbot/train/extract proxy, remove fake job-history endpoints"
```

---

# Part B — `yakuzi-web`

### Task 12: Admin — `chatbot.api.ts` + `useChatbot.ts`

**Files:**
- Create: `apps/admin/api/chatbot.api.ts`
- Create: `apps/admin/hooks/useChatbot.ts`

- [ ] **Step 1: Write the API client functions**

Create `apps/admin/api/chatbot.api.ts`, modeled on `apps/admin/api/seo.api.ts`'s response-unwrapping convention:

```typescript
import { apiClient } from "@/lib/apiClient";

export interface ChatbotRule {
  id: string;
  trigger: string;
  instruction: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listChatbotRules(): Promise<ChatbotRule[]> {
  const { data } = await apiClient.get<{ data: ChatbotRule[] }>("/admin/chatbot/rules");
  return data.data;
}

export async function createChatbotRule(payload: {
  trigger: string;
  instruction: string;
}): Promise<ChatbotRule> {
  const { data } = await apiClient.post<{ data: ChatbotRule }>("/admin/chatbot/rules", payload);
  return data.data;
}

export async function updateChatbotRule(
  id: string,
  payload: Partial<{ trigger: string; instruction: string; isActive: boolean }>,
): Promise<ChatbotRule> {
  const { data } = await apiClient.patch<{ data: ChatbotRule }>(`/admin/chatbot/rules/${id}`, payload);
  return data.data;
}

export async function deleteChatbotRule(id: string): Promise<void> {
  await apiClient.delete(`/admin/chatbot/rules/${id}`);
}

export interface ExtractedRuleDraft {
  trigger: string;
  instruction: string;
}

export async function extractChatbotRule(
  history: { role: string; content?: string }[],
): Promise<ExtractedRuleDraft> {
  const { data } = await apiClient.post<ExtractedRuleDraft>("/chatbot/train/extract", { history });
  return data;
}
```

- [ ] **Step 2: Write the React Query hooks**

Create `apps/admin/hooks/useChatbot.ts`, modeled on `apps/admin/hooks/useSeo.ts`:

```typescript
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listChatbotRules, createChatbotRule, updateChatbotRule, deleteChatbotRule, extractChatbotRule,
} from "@/api/chatbot.api";

export function useChatbotRules() {
  return useQuery({ queryKey: ["admin", "chatbot", "rules"], queryFn: listChatbotRules, staleTime: 30_000, retry: 1 });
}

export function useCreateChatbotRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createChatbotRule,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "chatbot", "rules"] }),
  });
}

export function useUpdateChatbotRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateChatbotRule>[1] }) =>
      updateChatbotRule(id, payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "chatbot", "rules"] }),
  });
}

export function useDeleteChatbotRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteChatbotRule,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "chatbot", "rules"] }),
  });
}

export function useExtractChatbotRule() {
  return useMutation({ mutationFn: extractChatbotRule });
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors (these files aren't imported anywhere yet, so this just confirms they're syntactically/type valid in isolation).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/api/chatbot.api.ts apps/admin/hooks/useChatbot.ts
git commit -m "feat: add admin API client + hooks for chatbot rules CRUD and extraction"
```

---

### Task 13: Admin — rewrite `apps/admin/app/chatbot/page.tsx`

**Files:**
- Modify: `apps/admin/app/chatbot/page.tsx`

- [ ] **Step 1: Replace the entire file**

The sandbox chat UI (message list rendering, `formatFormattedMessage`, the input form) stays as-is. What changes: all `fetch("/api/chatbot/...")` calls are replaced with the hooks from Task 12; the job-status banner and job-history table are replaced with the rules list; "Train on Conversation" becomes "Save conversation" with a review modal.

Replace the full contents of `apps/admin/app/chatbot/page.tsx` with:

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Bot, Save, Send, Trash2, Eraser, Brain, Power, PowerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";
import { AdminLayout } from "@/components/layout/admin-layout";
import { sendChatMessageFull, type ChatMessage } from "@yukizi/api-client";
import {
  useChatbotRules, useCreateChatbotRule, useUpdateChatbotRule, useDeleteChatbotRule, useExtractChatbotRule,
} from "@/hooks/useChatbot";

export default function ChatbotAdminPage() {
  const { data: rules = [], isLoading: rulesLoading } = useChatbotRules();
  const createRule = useCreateChatbotRule();
  const updateRule = useUpdateChatbotRule();
  const deleteRule = useDeleteChatbotRule();
  const extractRule = useExtractChatbotRule();

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string; thoughts?: string; thinkingTimeMs?: number }[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [draftTrigger, setDraftTrigger] = useState("");
  const [draftInstruction, setDraftInstruction] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isTyping) return;

    const userMsg = chatInput.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setChatInput("");
    setIsTyping(true);

    try {
      const history = messages.slice(-10) as ChatMessage[];
      const result = await sendChatMessageFull(userMsg, history);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: result.response,
        thoughts: result.thoughts,
        thinkingTimeMs: result.thinkingTimeMs,
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: "Error: Could not connect to chatbot." }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleOpenSaveModal = async () => {
    if (messages.length < 2) {
      toast.error("You need at least one user-assistant exchange to save a rule.");
      return;
    }
    try {
      const draft = await extractRule.mutateAsync(messages.map((m) => ({ role: m.role, content: m.content })));
      setDraftTrigger(draft.trigger);
      setDraftInstruction(draft.instruction);
    } catch (err) {
      // Extraction failing shouldn't block saving — admin can type it manually.
      setDraftTrigger("");
      setDraftInstruction("");
      toast.error("Couldn't auto-extract a rule — fill it in manually below.");
    }
    setIsSaveModalOpen(true);
  };

  const handleConfirmSave = async () => {
    if (!draftTrigger.trim() || !draftInstruction.trim()) {
      toast.error("Both fields are required.");
      return;
    }
    try {
      await createRule.mutateAsync({ trigger: draftTrigger.trim(), instruction: draftInstruction.trim() });
      toast.success("Rule saved.");
      setIsSaveModalOpen(false);
    } catch (err) {
      toast.error("Failed to save rule.");
    }
  };

  const handleToggleRule = async (id: string, isActive: boolean) => {
    try {
      await updateRule.mutateAsync({ id, payload: { isActive: !isActive } });
    } catch {
      toast.error("Failed to update rule.");
    }
  };

  const handleDeleteRule = (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Rule",
      message: "Are you sure you want to delete this rule? The live chatbot will stop following it immediately.",
      onConfirm: async () => {
        try {
          await deleteRule.mutateAsync(id);
          toast.success("Rule deleted.");
        } catch {
          toast.error("Failed to delete rule.");
        }
      },
    });
  };

  const handleClearAllRules = () => {
    setConfirmDialog({
      isOpen: true,
      title: "Clear All Rules & Reset Memory",
      message: "Are you sure you want to delete every learned rule? The chatbot will be reset to its default persona.",
      onConfirm: async () => {
        try {
          await Promise.all(rules.map((rule) => deleteRule.mutateAsync(rule.id)));
          toast.success("All rules cleared — chatbot reset to default persona.");
        } catch {
          toast.error("Failed to clear all rules.");
        }
      },
    });
  };

  const formatFormattedMessage = (content: string) => {
    if (!content) return null;
    const lines = content.split('\n');
    return lines.map((line, lineIdx) => {
      const parts = line.split(/(\*\*.*?\*\*)/g);
      const lineElements = parts.map((part, pIdx) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={pIdx} className="font-bold">{part.slice(2, -2)}</strong>;
        }
        return part;
      });

      const trimmed = line.trim();
      if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
        const rest = line.substring(line.indexOf(trimmed.startsWith('* ') ? '*' : '-') + 1);
        const bulletParts = rest.split(/(\*\*.*?\*\*)/g).map((part, pIdx) => {
          if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
            return <strong key={pIdx} className="font-bold">{part.slice(2, -2)}</strong>;
          }
          return part;
        });
        return (
          <div key={lineIdx} className="flex items-start gap-2 my-1 pl-1">
            <span className="text-primary font-bold">•</span>
            <div className="flex-1">{bulletParts}</div>
          </div>
        );
      }

      return (
        <div key={lineIdx} className={trimmed === '' ? 'h-2' : ''}>
          {lineElements}
        </div>
      );
    });
  };

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-8">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary/10 rounded-xl text-primary">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AI Chatbot Management</h1>
            <p className="text-muted-foreground text-sm">Configure persona, teach store-specific behavior, and test your assistant.</p>
          </div>
        </div>

        <div className="max-w-3xl mx-auto">
          {/* Sandbox Chat */}
          <div className="glass flex flex-col rounded-2xl border border-white/20 h-[700px] overflow-hidden shadow-2xl mb-8">
            <div className="p-4 border-b border-white/20 bg-accent/20 flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                Live Sandbox Testing
              </h2>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    setConfirmDialog({
                      isOpen: true,
                      title: "Clear Chat",
                      message: "Are you sure you want to clear the sandbox chat?",
                      onConfirm: () => setMessages([]),
                    });
                  }}
                  disabled={messages.length === 0}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-30 disabled:hover:text-muted-foreground"
                  title="Clear chat history"
                >
                  <Eraser className="h-3.5 w-3.5" /> Clear
                </button>
                <button
                  onClick={handleOpenSaveModal}
                  disabled={extractRule.isPending || messages.length < 2}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-muted-foreground"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save conversation
                </button>
              </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                  <Bot className="h-12 w-12 mb-3 opacity-20" />
                  <p className="text-sm">Send a message to test the chatbot</p>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={cn("flex max-w-[85%]", msg.role === "user" ? "ml-auto" : "mr-auto")}>
                  <div className={cn("p-3 rounded-2xl text-sm",
                    msg.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-accent rounded-bl-sm"
                  )}>
                    {msg.role === "assistant" && msg.thoughts && (
                      <details className="mb-2 text-xs bg-background/50 rounded-xl p-2 border border-border">
                        <summary className="cursor-pointer font-semibold flex items-center gap-1.5 select-none hover:text-primary transition-colors">
                          <Brain className="w-3.5 h-3.5 text-primary" />
                          Thinking Process {msg.thinkingTimeMs ? `(${(msg.thinkingTimeMs / 1000).toFixed(1)}s)` : ''}
                        </summary>
                        <div className="mt-2 text-2xs leading-relaxed whitespace-pre-wrap font-mono opacity-80 border-t border-border/50 pt-2">
                          {msg.thoughts}
                        </div>
                      </details>
                    )}
                    <div className="whitespace-pre-wrap leading-relaxed">{formatFormattedMessage(msg.content)}</div>
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex max-w-[80%] mr-auto">
                  <div className="p-3 rounded-2xl bg-accent rounded-bl-sm text-sm flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce delay-75" />
                    <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce delay-150" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="p-3 bg-background border-t border-border flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask the chatbot something..."
                className="flex-1 bg-transparent border-none outline-none text-sm px-2"
                disabled={isTyping}
              />
              <button
                type="submit"
                disabled={isTyping || !chatInput.trim()}
                className="bg-primary text-primary-foreground p-3 rounded-xl disabled:opacity-50 hover:bg-primary/90 transition-all flex items-center justify-center"
              >
                <Send className="h-5 w-5" />
              </button>
            </form>
          </div>

          {/* Rules */}
          <div className="glass p-6 rounded-2xl border border-white/20">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Learned Rules</h2>
              {rules.length > 0 && (
                <button
                  onClick={handleClearAllRules}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/10"
                  title="Delete every rule and reset the chatbot to its default persona"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear All & Reset Memory
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-3 px-4 font-medium">Trigger</th>
                    <th className="py-3 px-4 font-medium">Instruction</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rulesLoading ? (
                    <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">Loading...</td></tr>
                  ) : rules.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-muted-foreground">
                        No rules yet. Teach the bot something in the sandbox above, then "Save conversation."
                      </td>
                    </tr>
                  ) : (
                    rules.map((rule) => (
                      <tr key={rule.id} className="hover:bg-accent/20">
                        <td className="py-3 px-4 font-medium">{rule.trigger}</td>
                        <td className="py-3 px-4 text-muted-foreground">{rule.instruction}</td>
                        <td className="py-3 px-4">
                          <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", rule.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700')}>
                            {rule.isActive ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleToggleRule(rule.id, rule.isActive)}
                              className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                              title={rule.isActive ? "Deactivate" : "Activate"}
                            >
                              {rule.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => handleDeleteRule(rule.id)}
                              className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                              title="Delete rule"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Save Conversation Modal */}
        {isSaveModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-background border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl"
            >
              <h3 className="text-lg font-bold mb-2">Save conversation as a rule</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Review or edit before saving — this becomes live for every customer immediately.
              </p>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Trigger</label>
              <input
                type="text"
                value={draftTrigger}
                onChange={(e) => setDraftTrigger(e.target.value)}
                placeholder="e.g. best comic recommendation"
                className="w-full p-3 rounded-xl bg-accent border border-border text-sm outline-none focus:ring-2 focus:ring-primary mb-3"
                autoFocus
              />
              <label className="block text-xs font-medium text-muted-foreground mb-1">Instruction</label>
              <textarea
                value={draftInstruction}
                onChange={(e) => setDraftInstruction(e.target.value)}
                placeholder="e.g. must say kuji kari"
                rows={3}
                className="w-full p-3 rounded-xl bg-accent border border-border text-sm outline-none focus:ring-2 focus:ring-primary mb-6"
              />
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setIsSaveModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSave}
                  disabled={createRule.isPending}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Confirmation Dialog */}
        {confirmDialog.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-background border border-border p-6 rounded-2xl shadow-xl max-w-sm w-full mx-4"
            >
              <h3 className="text-lg font-bold mb-2">{confirmDialog.title}</h3>
              <p className="text-muted-foreground text-sm mb-6">{confirmDialog.message}</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
                  className="px-4 py-2 text-sm font-medium hover:bg-accent rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    confirmDialog.onConfirm();
                    setConfirmDialog({ ...confirmDialog, isOpen: false });
                  }}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/chatbot/page.tsx
git commit -m "refactor: admin chatbot page uses guarded NestJS endpoints and a real rules list"
```

---

### Task 14: Admin — delete the unauthenticated proxy route

**Files:**
- Delete: `apps/admin/app/api/chatbot/[...path]/route.ts`

- [ ] **Step 1: Confirm nothing else references it**

Run: `grep -rn "/api/chatbot" apps/admin/`
Expected: no matches (Task 13 already removed the only call sites).

- [ ] **Step 2: Delete it**

```bash
git rm apps/admin/app/api/chatbot/[...path]/route.ts
```

- [ ] **Step 3: Build**

Run: `cd apps/admin && npx next build`
Expected: clean build, `/api/chatbot/[...path]` no longer appears in the route list.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix: remove admin's unauthenticated direct-to-sidecar chatbot proxy"
```

---

### Task 15: Buyer — delete the unused, unauthenticated proxy route

**Files:**
- Delete: `apps/buyer/src/app/api/chatbot/[...path]/route.ts`

- [ ] **Step 1: Confirm it's genuinely unreferenced**

Run: `grep -rn "/api/chatbot" apps/buyer/src/`
Expected: no matches — the real chat widget already calls `sendChatMessageFull()` → NestJS directly (confirmed during design: `apps/buyer/src/components/landing/Navbar.tsx` imports it from `@yukizi/api-client`).

- [ ] **Step 2: Delete it**

```bash
git rm apps/buyer/src/app/api/chatbot/[...path]/route.ts
```

- [ ] **Step 3: Build**

Run: `cd apps/buyer && npx next build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix: remove unused, unauthenticated buyer-side chatbot proxy reachable from the public domain"
```

---

### Task 16: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suites**

```bash
# yakuzi-api
cd <api-repo-root>
npx tsc --noEmit
npm test
cd chatbot && pytest -v

# yakuzi-web
cd <web-repo-root>/apps/admin && npx tsc --noEmit && npx next build
cd <web-repo-root>/apps/buyer && npx tsc --noEmit && npx next build
```

Expected: all green.

- [ ] **Step 2: Manual verification checklist for the PR body**

- [ ] Sandbox: send a message, confirm it responds using general knowledge for an off-topic question (unrestricted-by-default safeguard).
- [ ] Sandbox: teach it something (e.g. "when asked about our return policy, mention the 7-day window"), click "Save conversation," confirm the draft modal shows a sensible trigger/instruction, confirm, and see it appear in the Learned Rules list.
- [ ] Ask the sandbox the trained question again in a **new** message — confirm it now follows the rule.
- [ ] Toggle the rule inactive — confirm the bot stops following it on the next message.
- [ ] Ask the bot to recommend a product by a vague description — confirm `search_products` returns real stock/rating, not just name/mrp.
- [ ] Ask the bot about a blog topic that has a published post — confirm it surfaces it.
- [ ] Ask the bot for reviews of a specific product — confirm it summarizes real review data.
- [ ] Confirm the buyer-facing chat widget still works end-to-end (unaffected by the admin-side rewiring).
- [ ] `curl -X POST https://<admin-domain>/api/chatbot/train/prompt` (or any other old proxy path) — confirm `404`, not a forwarded request.
- [ ] `curl -X POST https://<buyer-domain>/api/chatbot/anything` — confirm `404`.

- [ ] **Step 3: This step has no commit** — Task 16 is verification-only.
