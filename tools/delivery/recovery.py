#!/usr/bin/env python3
"""Bounded metadata inventory and synthetic staging backup/restore rehearsal."""

import argparse
import json
import logging
import os
import subprocess
from pathlib import Path

LOG = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["inventory", "backup", "restore-check"])
    parser.add_argument("--context", choices=["k8s-01"], required=True)
    parser.add_argument("--kubeconfig", required=True)
    parser.add_argument(
        "--environment", choices=["staging", "production"], default="staging"
    )
    parser.add_argument("--dump", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    namespace = f"davinci-sign-{args.environment}"
    LOG.info(
        "Target context=%s namespace=%s action=%s apply=%s",
        args.context,
        namespace,
        args.action,
        args.apply,
    )
    prefix = [
        "kubectl",
        "--kubeconfig",
        args.kubeconfig,
        "--context",
        args.context,
        "--namespace",
        namespace,
    ]

    def run(command, **kwargs):
        return subprocess.run(prefix + command, check=True, timeout=180, **kwargs)

    if args.action == "inventory":
        # Deliberately exclude Secret, ConfigMap data, logs and resource specs.
        for kind in [
            "deployments",
            "statefulsets",
            "persistentvolumeclaims",
            "jobs",
            "cronjobs",
        ]:
            result = json.loads(
                run(["get", kind, "-o", "json"], capture_output=True, text=True).stdout
            )
            for item in result["items"]:
                status = item.get("status", {})
                LOG.info(
                    "%s/%s ready=%s phase=%s succeeded=%s",
                    kind,
                    item["metadata"]["name"],
                    status.get("readyReplicas"),
                    status.get("phase"),
                    status.get("succeeded"),
                )
        LOG.info(
            "Metadata presence is not backup or restore proof. Verify Azure PostgreSQL PITR retention/restore and off-cluster object recovery separately before production release."
        )
        return
    if args.environment != "staging":
        raise ValueError(
            "Backup/restore rehearsal is restricted to synthetic staging data"
        )
    if args.dump is None:
        raise ValueError("--dump is required")
    if not args.apply:
        LOG.info(
            "Dry run: %s synthetic staging database using %s; no data read or written",
            args.action,
            args.dump,
        )
        return
    if args.action == "backup":
        fd = os.open(args.dump, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "wb") as output:
                run(
                    [
                        "exec",
                        "statefulset/postgres",
                        "--",
                        "sh",
                        "-ec",
                        'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"',
                    ],
                    stdout=output,
                )
        except BaseException:
            args.dump.unlink(missing_ok=True)
            raise
        LOG.info(
            "Synthetic staging dump saved with mode 0600; contains data, keep outside git"
        )
    else:
        # New scratch DB; never overwrite the application DB. Trap cleanup even on error.
        command = """set -eu
        scratch=sign_restore_rehearsal
        if psql -U "$POSTGRES_USER" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='sign_restore_rehearsal'" | grep -q 1; then
          echo 'Scratch database already exists; refusing overwrite' >&2; exit 1
        fi
        createdb -U "$POSTGRES_USER" "$scratch"
        trap 'dropdb -U "$POSTGRES_USER" "$scratch"' EXIT
        pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$scratch"
        psql -U "$POSTGRES_USER" -d "$scratch" -v ON_ERROR_STOP=1 -Atc 'SELECT count(*) FROM "_prisma_migrations"'
        psql -U "$POSTGRES_USER" -d "$scratch" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
        """
        with args.dump.open("rb") as source:
            result = run(
                ["exec", "-i", "statefulset/postgres", "--", "sh", "-ec", command],
                stdin=source,
                stdout=subprocess.PIPE,
            )
        counts = result.stdout.decode().strip().splitlines()
        if len(counts) < 2 or any(
            not value.isdigit() or int(value) < 1 for value in counts[-2:]
        ):
            raise ValueError(
                "Restored database has no applied migrations or public tables"
            )
        LOG.info(
            "Scratch restore and migration/table checks passed; scratch DB dropped. Full document/signing usability still requires UAT."
        )


if __name__ == "__main__":
    main()
