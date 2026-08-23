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
        [{"trigger": "best comic", "instruction": "say kuji kari", "tier": "SURFACE"}]
    )
    with patch("main.get_db_connection", return_value=mock_conn):
        rules = get_active_rules()

    assert rules == [{"trigger": "best comic", "instruction": "say kuji kari", "tier": "SURFACE"}]
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert '"isActive" = true' in executed_sql
    assert "LIMIT 100" in executed_sql
    # CORE-first tier ordering, then the admin's manual per-tier order.
    assert 'ORDER BY tier ASC, "order" ASC' in executed_sql


def test_get_active_rules_returns_empty_list_when_db_unavailable():
    with patch("main.get_db_connection", return_value=None):
        assert get_active_rules() == []


def test_get_active_rules_returns_empty_list_on_query_error():
    mock_conn = MagicMock()
    mock_conn.cursor.side_effect = Exception("connection reset")
    with patch("main.get_db_connection", return_value=mock_conn):
        assert get_active_rules() == []


def test_build_system_instruction_appends_rules_under_base_prompt():
    rules = [{"trigger": "best comic", "instruction": "say kuji kari", "tier": "SURFACE"}]
    with patch("main.get_active_rules", return_value=rules):
        instruction = build_system_instruction()

    assert instruction.startswith(DEFAULT_PROMPT.split("\n")[0][:20])
    assert "best comic: say kuji kari" in instruction


def test_build_system_instruction_puts_core_rules_in_their_own_priority_section():
    rules = [
        {"trigger": "brand voice", "instruction": "always warm and playful", "tier": "CORE"},
        {"trigger": "best comic", "instruction": "say kuji kari", "tier": "SURFACE"},
    ]
    with patch("main.get_active_rules", return_value=rules):
        instruction = build_system_instruction()

    # Scope assertions to the rules block — the base persona file could
    # legitimately contain any words, so index() on the whole string is fragile.
    rules_block = instruction[instruction.index("LEARNED RULES"):]
    core_section = rules_block.index("Core rules")
    surface_section = rules_block.index("Additional rules")
    assert core_section < surface_section
    assert rules_block.index("brand voice") < rules_block.index("best comic")


def test_build_system_instruction_falls_back_to_base_prompt_when_no_rules():
    with patch("main.get_active_rules", return_value=[]):
        instruction = build_system_instruction()

    assert "LEARNED RULES" not in instruction
