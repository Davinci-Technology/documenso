#!/usr/bin/env python3
"""Provision isolated staging credentials only; default is a local plan."""

import argparse
import base64
import json
import logging
import os
import secrets
import subprocess
import tempfile
from pathlib import Path

LOG = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True, choices=["k8s-01"])
    parser.add_argument("--kubeconfig", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ns = "davinci-sign-staging"
    LOG.info("Target context=%s namespace=%s apply=%s", args.context, ns, args.apply)
    LOG.info(
        "Create missing isolated auth/encryption/DB/storage keys, self-signed test certificate and registry pull secret; preserve existing secrets"
    )
    LOG.info(
        "Synthetic staging storage is ephemeral: PostgreSQL/MinIO pod replacement resets test data; no PVC/billable disk is provisioned"
    )
    if not args.apply:
        return
    prefix = [
        "kubectl",
        "--kubeconfig",
        args.kubeconfig,
        "--context",
        args.context,
        "--namespace",
        ns,
    ]

    def run(cmd, **kwargs):
        return subprocess.run(cmd, check=True, timeout=90, **kwargs)

    run(
        prefix + ["apply", "-f", "-"],
        input=json.dumps(
            {"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": ns}}
        ),
        text=True,
    )

    def exists(name):
        result = run(
            prefix + ["get", "secret", name, "--ignore-not-found", "-o", "name"],
            capture_output=True,
            text=True,
        )
        return bool(result.stdout.strip())

    def create(name, data):
        # stdin avoids process-list disclosure. API output reports metadata only.
        manifest = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": name, "namespace": ns},
            "data": {
                key: base64.b64encode(value).decode() for key, value in data.items()
            },
        }
        run(prefix + ["create", "-f", "-"], input=json.dumps(manifest), text=True)

    with tempfile.TemporaryDirectory(prefix="sign-staging-") as temp:
        directory = Path(temp)
        if not exists("davinci-sign-secrets"):
            # Certificate passphrase is independently unused for this test-only
            # certificate; create both in one bootstrap to avoid mismatched keys.
            if exists("davinci-sign-certificate"):
                raise ValueError(
                    "Partial credential state: certificate exists without app keys; inspect before provisioning"
                )
            passphrase = secrets.token_hex(24)
            passfile = directory / "passphrase"
            passfile.write_text(passphrase)
            passfile.chmod(0o600)
            run(
                [
                    "openssl",
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-nodes",
                    "-keyout",
                    str(directory / "key.pem"),
                    "-out",
                    str(directory / "cert.pem"),
                    "-days",
                    "90",
                    "-subj",
                    "/CN=staging-sign.davincisolutions.ai",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            run(
                [
                    "openssl",
                    "pkcs12",
                    "-export",
                    "-out",
                    str(directory / "cert.p12"),
                    "-inkey",
                    str(directory / "key.pem"),
                    "-in",
                    str(directory / "cert.pem"),
                    "-passout",
                    f"file:{passfile}",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            storage = secrets.token_hex(32)
            data = {
                "NEXTAUTH_SECRET": secrets.token_hex(32),
                "NEXT_PRIVATE_ENCRYPTION_KEY": secrets.token_hex(32),
                "NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY": secrets.token_hex(32),
                "POSTGRES_PASSWORD": secrets.token_hex(32),
                "MINIO_ROOT_PASSWORD": storage,
                "NEXT_PRIVATE_UPLOAD_SECRET_ACCESS_KEY": storage,
                "NEXT_PRIVATE_SMTP_PASSWORD": "staging-sink-only",
                "NEXT_PRIVATE_SIGNING_PASSPHRASE": passphrase,
            }
            create(
                "davinci-sign-certificate",
                {"cert.p12": (directory / "cert.p12").read_bytes()},
            )
            create(
                "davinci-sign-secrets",
                {key: value.encode() for key, value in data.items()},
            )
        elif not exists("davinci-sign-certificate"):
            raise ValueError(
                "Partial credential state: app keys exist without certificate; inspect before provisioning"
            )
        if not exists("acr-pull-secret"):
            required = ["REGISTRY_USERNAME", "REGISTRY_TOKEN"]
            missing = [name for name in required if not os.environ.get(name)]
            if missing:
                raise ValueError(
                    "Missing registry credential environment names: "
                    + ", ".join(missing)
                )
            auth = base64.b64encode(
                (
                    os.environ["REGISTRY_USERNAME"] + ":" + os.environ["REGISTRY_TOKEN"]
                ).encode()
            ).decode()
            docker = json.dumps(
                {"auths": {"davinciai.azurecr.io": {"auth": auth}}}
            ).encode()
            manifest = {
                "apiVersion": "v1",
                "kind": "Secret",
                "type": "kubernetes.io/dockerconfigjson",
                "metadata": {"name": "acr-pull-secret", "namespace": ns},
                "data": {".dockerconfigjson": base64.b64encode(docker).decode()},
            }
            run(prefix + ["create", "-f", "-"], input=json.dumps(manifest), text=True)
    LOG.info("Staging bootstrap complete; no existing key was changed")


if __name__ == "__main__":
    main()
