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
