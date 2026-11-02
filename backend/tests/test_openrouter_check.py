from app import openrouter_check
from app.openrouter import OpenRouterError


def test_connectivity_command_success_is_mocked(monkeypatch, capsys):
    monkeypatch.setattr(openrouter_check, "check_connectivity", lambda: "4")
    assert openrouter_check.main() == 0
    assert capsys.readouterr().out == "4\n"


def test_connectivity_command_reports_errors(monkeypatch, capsys):
    def fail():
        raise OpenRouterError("OpenRouter unavailable")
    monkeypatch.setattr(openrouter_check, "check_connectivity", fail)
    assert openrouter_check.main() == 1
    assert capsys.readouterr().err == "OpenRouter unavailable\n"
