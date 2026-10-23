"""`loop` entry point: `loop dev --spec N`. Help, --json and exit codes are described by `--help`."""

from __future__ import annotations

import json
import sys
from collections.abc import Callable

HELP = """usage: loop <command> [args] [--json] [-h]

commands:
  dev   [mutating] deliver the Tickets of a Spec: worktree, agent run per Ticket, draft PR

flags:
  --json      print {command, ok, exitCode} on stdout when the command ends
  -h, --help  help for loop or a command

exit codes: 0 all delivered, 1 a Ticket failed, 2 usage error"""

DEV_HELP = """usage: loop dev [--spec NUMBER] [--log-dir DIR] [--log-level LEVEL] [--json]

Plan, deliver, verify, review and finalize an open Spec issue on the harness repo. [mutating]
A planner agent creates missing Tickets (sub-issues); the harness runs a developer agent per Ticket
on one worktree and makes every commit; verifier, chore and reviewer agents follow, and the draft
PR is marked ready only when every gate passes.

flags:
  --spec NUMBER    deliver only this Spec issue number (default: every open Spec)
  --log-dir DIR    journal and log folder (default: ./.loop)
  --log-level L    logging level (default: INFO)
  --json           print {command, ok, exitCode} on stdout when done

examples:
  loop dev --spec 123
  loop dev --spec 123 --log-level DEBUG --json"""


def _run_dev(arguments: list[str]) -> int:
    from .dev.run import main

    return main(arguments)


def main(argv: list[str] | None = None, *, run_dev: Callable[[list[str]], int] = _run_dev) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in arguments
    arguments = [argument for argument in arguments if argument != "--json"]

    if not arguments or arguments[0] == "help" or arguments in (["-h"], ["--help"]):
        print(DEV_HELP if arguments[1:2] == ["dev"] else HELP)
        return 0
    if arguments[0] != "dev":
        print(f'Unknown command "{arguments[0]}".\nRun: loop --help', file=sys.stderr)
        return 2
    if any(argument in ("-h", "--help") for argument in arguments[1:]):
        print(DEV_HELP)
        return 0

    try:
        exit_code = run_dev(arguments[1:])
    except SystemExit as exception:
        exit_code = exception.code if isinstance(exception.code, int) else 1
    if as_json:
        print(json.dumps({"command": "loop dev", "ok": exit_code == 0, "exitCode": exit_code}))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
