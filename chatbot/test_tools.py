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
