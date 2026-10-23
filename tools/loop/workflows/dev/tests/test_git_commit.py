from __future__ import annotations

from pathlib import Path

import pytest

from workflows.dev.checkout import GitService
from workflows.dev.tests.doubles import commit_file, git


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    path = tmp_path / "repo"
    path.mkdir()
    git(path, "init", "-b", "main")
    git(path, "config", "user.email", "test@example.com")
    git(path, "config", "user.name", "Test")
    commit_file(path, "README.md", "hello\n", "initial")
    return path


def test_the_harness_commit_stages_everything_and_carries_subject_and_body(repo: Path) -> None:
    (repo / "README.md").write_text("changed\n")
    (repo / "new.txt").write_text("new\n")
    service = GitService()

    commit = service.commit(repo, "ccode(X|1): work", "summary\n\nVerification:\nran tests")

    assert commit.subject == "ccode(X|1): work" and "ran tests" in commit.body
    assert service.is_clean(repo) and service.head(repo).sha == commit.sha
    assert git(repo, "show", "--name-only", "--format=", "HEAD").splitlines() == ["README.md", "new.txt"]


def test_changed_files_lists_modified_untracked_and_renamed_paths(repo: Path) -> None:
    (repo / "dir").mkdir()
    (repo / "dir" / "a.txt").write_text("a\n")
    git(repo, "mv", "README.md", "RENAMED.md")
    service = GitService()

    assert sorted(service.changed_files(repo)) == ["RENAMED.md", "dir/a.txt"]
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "x")
    assert service.changed_files(repo) == []


def test_status_snapshots_differ_once_the_tree_changes_and_ref_sha_resolves_refs(repo: Path) -> None:
    service = GitService()
    before = service.status(repo)

    (repo / "x.txt").write_text("x\n")

    assert service.status(repo) != before
    assert service.ref_sha(repo, "main") == service.head(repo).sha
