from decimal import Decimal
from unittest.mock import MagicMock, patch

from main import search_products, search_products_impl


def _mock_conn_returning(rows):
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = rows
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    return mock_conn, mock_cursor


def test_search_products_queries_description_category_stock_and_rating():
    rows = [{
        "name": "Naruto Vol. 1", "slug": "naruto-vol-1", "manufacturer": "Viz Media",
        "price": 499, "description": "First volume", "category": "Books",
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
    # One token, three columns, used twice: once to score, once to filter.
    assert params == ("%naruto%",) * 6


def test_search_products_ranks_by_match_then_stock_then_rating():
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products("naruto")
    executed_sql = mock_cursor.execute.call_args[0][0]
    # Alphabetical ordering used to surface out-of-stock figures first.
    assert "ORDER BY t.match_score DESC, t.stock DESC, t.avg_rating DESC" in executed_sql


def test_search_products_drops_retail_filler_from_a_natural_phrase():
    """"which naruto toy should i buy" must not become ILIKE '%naruto toy%'."""
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products("which naruto toy should i buy")
    params = mock_cursor.execute.call_args[0][1]
    assert set(params) == {"%naruto%"}


def test_search_products_matches_any_token_not_the_whole_phrase():
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products("naruto uzumaki")
    executed_sql = mock_cursor.execute.call_args[0][0]
    where = executed_sql.split("WHERE", 1)[1]
    # Tokens are OR'd: a product named "Naruto Uzumaki Chibi" matches, and so
    # does one named just "Naruto".
    assert " OR " in where
    params = mock_cursor.execute.call_args[0][1]
    assert set(params) == {"%naruto%", "%uzumaki%"}


def test_search_tokens_falls_back_when_every_word_is_filler():
    from main import search_tokens
    # Never send an empty WHERE clause to the database.
    assert search_tokens("what should i buy") == ["what", "should", "i", "buy"]
    assert search_tokens("") == [""]


def test_search_products_returns_a_ready_made_product_url():
    rows = [{
        "name": "Naruto Vol. 1", "slug": "naruto-vol-1", "manufacturer": "Viz Media",
        "price": 499, "description": "First volume", "category": "Books",
        "stock": 12, "avg_rating": 4.5,
    }]
    mock_conn, _ = _mock_conn_returning(rows)
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_products("naruto")
    # The model must never have to assemble a path itself.
    assert "/products/naruto-vol-1" in result
    assert "slug" not in result


def test_search_products_omits_url_when_a_product_has_no_slug():
    rows = [{
        "name": "Unslugged Figure", "slug": None, "manufacturer": "Banpresto",
        "price": 1299, "description": "", "category": "Figurines",
        "stock": 3, "avg_rating": 0,
    }]
    mock_conn, _ = _mock_conn_returning(rows)
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_products("unslugged")
    assert "'url': None" in result


def test_search_products_prices_from_the_cheapest_live_offer_not_catalog_mrp():
    """catalog_products.mrp is nullable and unset for seller-priced products, so
    reading it had the assistant telling customers it could not see prices at
    all. The price must be what the storefront actually charges
    (products.service.ts): take the cheapest live offer by MRP, then
    finalCustomerPayable, falling back to the offer's MRP."""
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products("naruto")
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "cp.mrp" not in executed_sql
    assert 'COALESCE(so."finalCustomerPayable", so.mrp)' in executed_sql
    assert "ORDER BY so.mrp ASC LIMIT 1" in executed_sql
    # Only offers a customer could actually buy from may set the price.
    assert executed_sql.count("so.\"approvalStatus\" = 'APPROVED'") >= 2


def test_search_products_casts_decimal_price_to_a_plain_float():
    # RealDictCursor returns Decimal for numeric columns; str(Decimal(...))
    # renders as "Decimal('1299.00')", which Gemini could echo to a customer.
    rows = [{
        "name": "Akaza Statue", "slug": "akaza-yukizi", "manufacturer": "Banpresto",
        "price": Decimal("1299.00"), "description": "", "category": "Figurines",
        "stock": 3, "avg_rating": Decimal("4.5"),
    }]
    mock_conn, _ = _mock_conn_returning(rows)
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_products("akaza")
    assert "'price': 1299.0" in result
    assert "Decimal" not in result


def test_search_products_leaves_price_none_when_no_live_offer():
    # No active approved offer means there is genuinely no price to quote;
    # None must survive so the model sends the customer to the product page
    # rather than inventing a number.
    rows = [{
        "name": "Retired Figure", "slug": "retired-figure", "manufacturer": "Banpresto",
        "price": None, "description": "", "category": "Figurines",
        "stock": 0, "avg_rating": 0,
    }]
    mock_conn, _ = _mock_conn_returning(rows)
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_products("retired")
    assert "'price': None" in result


def test_search_products_filters_by_max_price():
    """"tell me items below 2000" had the assistant answering it cannot filter
    by price, because the tool only accepted a text query. A budget must reach
    the database as a bound on the live offer price."""
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products_impl("naruto", max_price=2000)
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "t.price <= %s" in executed_sql
    params = mock_cursor.execute.call_args[0][1]
    assert params[-1] == 2000


def test_search_products_filters_by_min_and_max_price():
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products_impl("figure", max_price=5000, min_price=1000)
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "t.price <= %s" in executed_sql
    assert "t.price >= %s" in executed_sql
    params = mock_cursor.execute.call_args[0][1]
    assert 5000 in params and 1000 in params


def test_search_products_without_a_budget_adds_no_price_clause():
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products("naruto")
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "t.price" not in executed_sql


def test_search_products_budget_only_query_considers_the_whole_catalogue():
    """A customer who only gives a budget ("items below 2000") has no product
    words to match. Text-matching the leftovers ("items", "2000") finds
    nothing, so with a price bound present the text filter must be dropped
    entirely, not sent to the database as an unmatchable phrase."""
    for q in ("", "items below 2000"):
        mock_conn, mock_cursor = _mock_conn_returning([])
        with patch("main.get_db_connection", return_value=mock_conn):
            search_products_impl(q, max_price=2000)
        executed_sql = mock_cursor.execute.call_args[0][0]
        assert "ILIKE" not in executed_sql, q
        assert "t.price <= %s" in executed_sql, q
        assert mock_cursor.execute.call_args[0][1] == (2000,), q


def test_search_tokens_drops_price_words_and_bare_numbers():
    from main import search_tokens
    # "naruto under 2000" must search for naruto, not for the budget.
    assert search_tokens("naruto under 2000") == ["naruto"]


def test_search_products_coerces_string_price_bounds():
    """Gemini has been observed sending numeric arguments as strings. A string
    "2000" must become a numeric bound, not reach psycopg2 as text (numeric <=
    text is an operator error in Postgres)."""
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products_impl("naruto", max_price="2000", min_price="500")
    params = mock_cursor.execute.call_args[0][1]
    assert params[-2:] == (2000.0, 500.0)


def test_search_products_rejects_unparseable_price_bounds():
    mock_conn, _ = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_products_impl("naruto", max_price="two thousand")
    assert "must be numbers" in result


def test_search_products_logs_query_errors_to_stderr(capsys):
    """The error string goes back to the model, which paraphrases it away —
    without a server-side trace there is nothing in pm2 logs to diagnose."""
    mock_cursor = MagicMock()
    mock_cursor.execute.side_effect = Exception("operator does not exist")
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_products("naruto")
    assert "Error executing query" in result
    assert "operator does not exist" in capsys.readouterr().err


def test_search_products_parses_a_budget_out_of_the_query_text():
    """The production sidecar's legacy interpreter runs a google-genai old
    enough to drop Optional parameters from the tool schema, so the model
    cannot pass max_price at all. The budget must therefore also work when it
    arrives inside the query text, which every SDK version can deliver."""
    cases = [
        ("naruto under 2000", "t.price <= %s", 2000.0),
        ("naruto below ₹1,500", "t.price <= %s", 1500.0),
        ("naruto less than 800 rupees", "t.price <= %s", 800.0),
        ("naruto above 1000", "t.price >= %s", 1000.0),
        ("naruto over 3000", "t.price >= %s", 3000.0),
    ]
    for text, clause, bound in cases:
        mock_conn, mock_cursor = _mock_conn_returning([])
        with patch("main.get_db_connection", return_value=mock_conn):
            search_products(text)
        executed_sql = mock_cursor.execute.call_args[0][0]
        assert clause in executed_sql, text
        params = mock_cursor.execute.call_args[0][1]
        assert params[-1] == bound, text
        # The budget words must not leak into the text match.
        assert all("2000" not in str(p) or p == bound for p in params), text


def test_search_products_parses_a_between_range_from_the_query_text():
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products("figures between 500 and 2000")
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "t.price <= %s" in executed_sql
    assert "t.price >= %s" in executed_sql
    params = mock_cursor.execute.call_args[0][1]
    assert 2000.0 in params and 500.0 in params


def test_search_products_budget_only_text_query_matches_whole_catalogue():
    # "suggest me items below 2000" — no product words at all.
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products("suggest me items below 2000")
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "ILIKE" not in executed_sql
    assert "t.price <= %s" in executed_sql
    assert mock_cursor.execute.call_args[0][1] == (2000.0,)


def test_search_products_explicit_price_params_win_over_parsed_text():
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products_impl("naruto under 5000", max_price=2000)
    params = mock_cursor.execute.call_args[0][1]
    assert params[-1] == 2000.0
    assert 5000.0 not in params


def test_search_products_plain_query_parses_no_budget():
    # A number that is part of a product name ("one piece film red 2022"
    # style) must not silently become a price cap without a budget word.
    mock_conn, mock_cursor = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        search_products("naruto figures")
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "t.price" not in executed_sql


def test_search_products_no_results_mentions_the_price_range():
    mock_conn, _ = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_products_impl("naruto", max_price=100)
    assert "price range" in result


def test_search_products_returns_no_results_message_when_empty():
    mock_conn, _ = _mock_conn_returning([])
    with patch("main.get_db_connection", return_value=mock_conn):
        result = search_products("nonexistent")
    assert "No products found" in result


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


def test_search_products_schema_declares_only_query():
    """The declared max_price/min_price parameters were rejected at the SDK's
    argument-validation layer in production before the tool ever ran, and the
    model turned that into refusals. The public tool must expose exactly one
    string parameter; budgets travel inside the text."""
    from google.genai import types
    fd = types.FunctionDeclaration.from_callable_with_api_option(callable=search_products)
    assert sorted(fd.parameters.properties.keys()) == ["query"]
    assert fd.parameters.required == ["query"]
