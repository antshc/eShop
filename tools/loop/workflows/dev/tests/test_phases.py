from __future__ import annotations

from pathlib import Path

import pytest

from workflows.dev.phases import FAIL, SUCCESS, Kind, Owner, OtelPhases
from workflows.dev.tests.doubles import DevHarness, RecordingPhases, issue


def test_a_phase_defaults_to_fail_and_a_clean_exit_flips_it_to_success() -> None:
    phases = RecordingPhases()

    with phases.phase("commit", Kind.CODE, Owner.CODE, ticket=10) as phase:
        assert phase.status == FAIL

    [done] = phases.finished
    assert (done.status, done.kind, done.owner, done.attributes) == (SUCCESS, "code", "code", {"ticket": 10})


def test_a_failed_gate_fails_the_phase_even_on_a_clean_exit() -> None:
    phases = RecordingPhases()

    with phases.phase("ticket #10", Kind.AGENT, Owner.DEVELOPER) as phase:
        assert phase.gate("tests pass", True)
        assert not phase.gate("the agent did not commit", False, "it committed")

    [done] = phases.finished
    assert done.status == FAIL and done.reason == "it committed"
    assert done.gates == [("tests pass", True, ""), ("the agent did not commit", False, "it committed")]


def test_an_exception_fails_the_phase_and_propagates() -> None:
    phases = RecordingPhases()

    with pytest.raises(RuntimeError, match="boom"):
        with phases.phase("publish", Kind.CODE, Owner.CODE):
            raise RuntimeError("boom")

    assert (phases.finished[0].status, phases.finished[0].reason) == (FAIL, "boom")


def test_the_otel_phases_export_each_phase_as_a_span_on_its_owners_resource() -> None:
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
    from opentelemetry.sdk.resources import Resource
    from loop import Role
    from loop.observe.otel import OtlpObserver

    exporters: dict[str, InMemorySpanExporter] = {}
    providers: dict[str, TracerProvider] = {}

    def provider(name: str) -> TracerProvider:
        if name not in providers:
            exporters[name] = InMemorySpanExporter()
            providers[name] = TracerProvider(resource=Resource.create({"service.name": name}))
            providers[name].add_span_processor(SimpleSpanProcessor(exporters[name]))
        return providers[name]

    observer = OtlpObserver(tracer_provider=provider("loop-dev"), resource_providers=provider)
    phases = OtelPhases(observer)

    with phases.phase("spec #1", Kind.ENGINEER, Role.ENGINEER):
        with phases.phase("ticket #10", Kind.AGENT, Owner.DEVELOPER, ticket=10) as phase:
            phase.gate("the agent did not commit", False, "it committed")
        with phases.phase("commit", Kind.CODE, Owner.CODE, commit="abc"):
            pass

    assert {"engineer", "developer", "code"} <= set(exporters)
    [ticket] = exporters["developer"].get_finished_spans()
    assert ticket.attributes["loop.phase.status"] == "fail" and ticket.attributes["loop.ticket"] == 10
    assert ticket.attributes["loop.phase.kind"] == "agent" and ticket.attributes["loop.phase.owner"] == "developer"
    assert ticket.events[0].name == "loop.gate" and ticket.events[0].attributes["loop.gate.ok"] is False
    [commit] = exporters["code"].get_finished_spans()
    [root] = exporters["engineer"].get_finished_spans()
    assert commit.attributes["loop.phase.status"] == "success"
    assert commit.parent.span_id == root.context.span_id


def test_a_run_traces_every_stage_with_its_actor(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    phases = RecordingPhases()

    assert harness.run(lambda prompt: harness.edit_and_report(10), phases=phases) == 0

    stages = [(phase.name, phase.kind, phase.owner) for phase in phases.finished]
    assert stages == [
        ("publish", "code", "code"),
        ("preflight", "code", "code"),
        ("ticket #10", "agent", "developer"),
        ("commit", "code", "code"),
        ("close-ticket", "code", "code"),
        ("publish", "code", "code"),
        ("publish", "code", "code"),
        ("chore", "agent", "chore"),
        ("deliver", "code", "code"),
        ("review", "agent", "reviewer"),
        ("finalize", "code", "code"),
        ("spec #1", "engineer", "engineer"),
    ]
    assert all(phase.status == SUCCESS for phase in phases.finished)


def test_a_failed_ticket_shows_as_a_failed_agent_phase_with_its_gate(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path, tickets={1: [issue(10, "Add login form")]})
    phases = RecordingPhases()

    assert harness.run(lambda prompt: "no json", phases=phases) == 1

    failed = phases.named("ticket #10")
    assert len(failed) == 2 and all(phase.status == FAIL for phase in failed)
    assert [phase.name for phase in phases.finished if phase.name == "escalate"] == ["escalate"]
