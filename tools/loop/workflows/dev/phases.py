"""Run phases: every stage of the dev flow is a phase owned by one actor, exported as a span on that actor's resource."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from contextlib import AbstractContextManager, contextmanager, nullcontext
from typing import Any

from loop import Role


class Kind:
    """Who performs a phase: the human, deterministic harness code, or an agent."""

    ENGINEER = "engineer"
    CODE = "code"
    AGENT = "agent"


class Owner:
    """Actor names; each is exported as its own Aspire resource (the loop `Role` names plus two workflow-specific agents)."""

    ENGINEER = Role.ENGINEER
    CODE = Role.CODE
    PLANNER = Role.PLANNER
    DEVELOPER = Role.DEVELOPER
    VERIFIER = "verifier"
    CHORE = "chore"
    REVIEWER = Role.REVIEWER


SUCCESS = "success"


FAIL = "fail"


class Phase:
    """One stage's outcome. It defaults to `fail`; a clean exit flips it to `success` unless a gate or the owner failed it."""

    def __init__(self, name: str, kind: str, owner: str, attributes: Mapping[str, Any]) -> None:
        self.name = name
        self.kind = kind
        self.owner = owner
        self.attributes: dict[str, Any] = dict(attributes)
        self.status = FAIL
        self.reason: str | None = None
        self.gates: list[tuple[str, bool, str]] = []
        self._failed = False

    def set(self, **attributes: Any) -> None:
        """Adds attributes to the phase's span."""
        self.attributes.update(attributes)

    def gate(self, check: str, ok: bool, note: str = "") -> bool:
        """Records one verified claim; a failed gate fails the phase. Returns `ok`."""
        self.gates.append((check, ok, note))
        if not ok:
            self.fail(note or check)
        return ok

    def fail(self, reason: str) -> None:
        if not self._failed:
            self.reason = reason
        self._failed = True
        self.status = FAIL

    def succeed(self) -> None:
        if not self._failed:
            self.status = SUCCESS


class Phases:
    """Opens phases; this base class only tracks them, `OtelPhases` also exports them."""

    @contextmanager
    def phase(self, name: str, kind: str, owner: str, **attributes: Any) -> Iterator[Phase]:
        phase = Phase(name, kind, owner, attributes)
        with self._span(phase) as span:
            try:
                yield phase
            except BaseException as exception:
                phase.fail(str(exception) or type(exception).__name__)
                raise
            else:
                phase.succeed()
            finally:
                self._finish(phase, span)

    def _span(self, phase: Phase) -> AbstractContextManager[Any]:
        return nullcontext()

    def _finish(self, phase: Phase, span: Any) -> None:
        return None


class OtelPhases(Phases):
    """Exports each phase as a span on the resource named after its owner; needs the `loop[otel]` extra."""

    def __init__(self, observer: Any) -> None:
        self._observer = observer

    def _span(self, phase: Phase) -> AbstractContextManager[Any]:
        return self._observer.span(phase.name, {"loop.phase.kind": phase.kind, "loop.phase.owner": phase.owner}, role=phase.owner)

    def _finish(self, phase: Phase, span: Any) -> None:
        from opentelemetry.trace import Status, StatusCode

        span.set_attribute("loop.phase.status", phase.status)
        for key, value in phase.attributes.items():
            if value is not None:
                span.set_attribute(f"loop.{key}", value if isinstance(value, (str, int, float, bool)) else str(value))
        for check, ok, note in phase.gates:
            span.add_event("loop.gate", {"loop.gate.check": check, "loop.gate.ok": ok, "loop.gate.note": note})
        if phase.status != SUCCESS:
            span.set_status(Status(StatusCode.ERROR, phase.reason or "phase failed"))
