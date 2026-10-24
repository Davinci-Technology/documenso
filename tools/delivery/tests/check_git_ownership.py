#!/usr/bin/env python3
"""Actual Git cross-UID regression; run as root in the pinned CI tools image."""

import argparse
import importlib.util
import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path

LOG = logging.getLogger(__name__)


def git(*args, check=True):
    return subprocess.run(
        ["git", *args], check=check, capture_output=True, text=True, timeout=30
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--baseline",
        action="store_true",
        help="Prove the unchanged helper fails before the correction",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if os.geteuid() != 0:
        raise ValueError("Run only as UID0 in the disposable CI tools-image container")
    sys.path.insert(0, str(Path(__file__).parents[1]))
    spec = importlib.util.spec_from_file_location(
        "release", Path(__file__).parents[1] / "release.py"
    )
    release = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(release)
    before = git("config", "--global", "--get-all", "safe.directory", check=False)
    with tempfile.TemporaryDirectory(prefix="sign-git-ownership-") as directory:
        repos = [Path(directory) / name for name in ["checkout", "unrelated"]]
        heads = []
        for repo in repos:
            repo.mkdir()
            git("-C", str(repo), "init", "-q")
            git(
                "-C",
                str(repo),
                "-c",
                "user.name=Synthetic CI",
                "-c",
                "user.email=synthetic@example.invalid",
                "commit",
                "--allow-empty",
                "-qm",
                "synthetic",
            )
            heads.append(git("-C", str(repo), "rev-parse", "HEAD").stdout.strip())
            for path in [repo, *repo.rglob("*")]:
                os.chown(path, 1000, 1000)
        denied = git("-C", str(repos[0]), "rev-parse", "HEAD", check=False)
        assert denied.returncode == 128 and "dubious ownership" in denied.stderr.lower()
        LOG.info(
            "Same-image baseline UID0 reading UID1000 checkout: exit128, dubious ownership confirmed"
        )
        trusted = git(
            "-c",
            "safe.directory=" + str(repos[0]),
            "-C",
            str(repos[0]),
            "rev-parse",
            "HEAD",
        )
        assert trusted.stdout.strip() == heads[0]
        LOG.info(
            "Per-command exact checkout safe.directory returns expected full commit"
        )
        release.ROOT = repos[0]
        if args.baseline:
            try:
                release.git("rev-parse", "HEAD")
            except subprocess.CalledProcessError as error:
                assert (
                    error.returncode == 128
                    and "dubious ownership" in error.stderr.lower()
                )
            else:
                raise AssertionError(
                    "Unchanged helper did not reproduce expected ownership rejection"
                )
            LOG.info("Unchanged actual release.git helper reproduces exit128")
        else:
            assert release.git("rev-parse", "HEAD") == heads[0]
            assert len(release.git("rev-parse", "HEAD^{tree}")) == 40
            LOG.info("Corrected actual release.git helper resolves commit and tree")
        unrelated = git("-C", str(repos[1]), "rev-parse", "HEAD", check=False)
        assert (
            unrelated.returncode == 128
            and "dubious ownership" in unrelated.stderr.lower()
        )
        LOG.info("Unrelated UID1000 repository remains untrusted exit128")
        after = git("config", "--global", "--get-all", "safe.directory", check=False)
        assert (before.returncode, before.stdout) == (after.returncode, after.stdout)
        LOG.info(
            "Global Git trust configuration unchanged; no wildcard/global trust added"
        )


if __name__ == "__main__":
    main()
