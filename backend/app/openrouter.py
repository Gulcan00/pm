import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "openai/gpt-oss-120b"
MAX_RESPONSE_BYTES = 1_000_000


class OpenRouterError(Exception):
    pass


def chat_completion(
    messages: list[dict[str, str]],
    api_key: str | None = None,
    opener=urlopen,
) -> str:
    resolved_key = api_key if api_key is not None else os.environ.get("OPENROUTER_API_KEY", "")
    if not resolved_key:
        raise OpenRouterError("OpenRouter is not configured. Set OPENROUTER_API_KEY.")

    request = Request(
        OPENROUTER_URL,
        data=json.dumps({"model": MODEL, "messages": messages}).encode(),
        headers={
            "Authorization": f"Bearer {resolved_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with opener(request, timeout=60) as response:
            response_body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(response_body) > MAX_RESPONSE_BYTES:
            raise OpenRouterError("OpenRouter returned an oversized response.")
        data = json.loads(response_body)
        content = data["choices"][0]["message"]["content"]
    except HTTPError as error:
        raise OpenRouterError(
            f"OpenRouter request failed with HTTP {error.code}."
        ) from None
    except (URLError, TimeoutError, OSError):
        raise OpenRouterError("Unable to reach OpenRouter. Check the connection and try again.") from None
    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
        raise OpenRouterError("OpenRouter returned an invalid response.") from None

    if not isinstance(content, str) or not content.strip():
        raise OpenRouterError("OpenRouter returned an empty response.")
    return content


def check_connectivity(api_key: str | None = None, opener=urlopen) -> str:
    answer = chat_completion(
        [{"role": "user", "content": "What is 2 + 2? Reply with the number only."}],
        api_key=api_key,
        opener=opener,
    )
    if not re.search(r"(?<!\d)4(?!\d)", answer):
        raise OpenRouterError("OpenRouter connectivity check returned an unexpected answer.")
    return answer