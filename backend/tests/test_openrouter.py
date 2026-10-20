import json
from io import BytesIO
from urllib.error import HTTPError

import pytest

from app.openrouter import (
    MAX_RESPONSE_BYTES,
    MODEL,
    OPENROUTER_URL,
    OpenRouterError,
    chat_completion,
    check_connectivity,
)


def provider_response(content: str) -> BytesIO:
    return BytesIO(
        json.dumps({"choices": [{"message": {"content": content}}]}).encode()
    )


def test_chat_completion_builds_openrouter_request() -> None:
    captured = {}

    def opener(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return provider_response("Ready")

    result = chat_completion(
        [{"role": "user", "content": "Hello"}],
        api_key="test-key",
        opener=opener,
    )

    request = captured["request"]
    payload = json.loads(request.data)
    assert result == "Ready"
    assert request.full_url == OPENROUTER_URL
    assert request.get_header("Authorization") == "Bearer test-key"
    assert payload == {
        "model": MODEL,
        "messages": [{"role": "user", "content": "Hello"}],
    }
    assert captured["timeout"] == 60


def test_chat_completion_requires_an_api_key(monkeypatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with pytest.raises(OpenRouterError, match="Set OPENROUTER_API_KEY"):
        chat_completion([], api_key="")


def test_chat_completion_reports_provider_errors_without_response_body() -> None:
    def opener(request, timeout):
        raise HTTPError(request.full_url, 429, "rate limit", {}, BytesIO(b"private body"))

    with pytest.raises(OpenRouterError, match="HTTP 429") as error:
        chat_completion([], api_key="test-key", opener=opener)

    assert "private body" not in str(error.value)
    assert "test-key" not in str(error.value)


def test_chat_completion_rejects_malformed_provider_response() -> None:
    with pytest.raises(OpenRouterError, match="invalid response"):
        chat_completion([], api_key="test-key", opener=lambda *_args, **_kwargs: BytesIO(b"{}"))


def test_chat_completion_rejects_oversized_provider_response() -> None:
    body = json.dumps(
        {"choices": [{"message": {"content": "x" * MAX_RESPONSE_BYTES}}]}
    ).encode()

    with pytest.raises(OpenRouterError, match="oversized response"):
        chat_completion(
            [], api_key="test-key", opener=lambda *_args, **_kwargs: BytesIO(body)
        )


def test_connectivity_check_asks_two_plus_two_and_checks_answer() -> None:
    captured = {}

    def opener(request, timeout):
        captured["payload"] = json.loads(request.data)
        return provider_response("4")

    assert check_connectivity(api_key="test-key", opener=opener) == "4"
    assert captured["payload"]["messages"] == [
        {"role": "user", "content": "What is 2 + 2? Reply with the number only."}
    ]


def test_connectivity_check_rejects_unexpected_answer() -> None:
    with pytest.raises(OpenRouterError, match="unexpected answer"):
        check_connectivity(api_key="test-key", opener=lambda *_args, **_kwargs: provider_response("five"))