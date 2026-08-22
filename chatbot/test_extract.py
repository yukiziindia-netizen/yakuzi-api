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
