from __future__ import annotations

import json

import pytest

from workflows.__main__ import main


def test_help_lists_dev_and_exits_zero(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--help"]) == 0
    assert "dev" in capsys.readouterr().out


def test_dev_help_has_examples_and_does_not_run(capsys: pytest.CaptureFixture[str]) -> None:
    def fail(arguments: list[str]) -> int:
        raise AssertionError("dev must not run for --help")

    assert main(["dev", "--help"], run_dev=fail) == 0
    assert "examples:" in capsys.readouterr().out


def test_unknown_command_is_a_usage_error(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["nope"]) == 2
    assert "loop --help" in capsys.readouterr().err


def test_dev_forwards_arguments_without_json_and_returns_exit_code(capsys: pytest.CaptureFixture[str]) -> None:
    received: list[list[str]] = []

    def run_dev(arguments: list[str]) -> int:
        received.append(arguments)
        return 1

    assert main(["dev", "--spec", "7", "--json"], run_dev=run_dev) == 1
    assert received == [["--spec", "7"]]
    assert json.loads(capsys.readouterr().out) == {"command": "loop dev", "ok": False, "exitCode": 1}


def test_argparse_exit_becomes_exit_code() -> None:
    def run_dev(arguments: list[str]) -> int:
        raise SystemExit(2)

    assert main(["dev", "--bogus"], run_dev=run_dev) == 2
