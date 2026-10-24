#!/usr/bin/env python3
"""Resolve only reviewed kubeconfig aliases after local public cluster identity checks."""

import argparse
import base64
import hashlib
import logging
import ssl
import subprocess

SERVER = "https://k8s-01-dns-3l35exx4.hcp.canadacentral.azmk8s.io:443"
CA_DER_SHA256 = "41d67224f5b8a393648f51ff37adcbd377b2778bef2ecf383991e52bd0b36916"
ALIASES = {"k8s-01", "k8s-01-admin"}
LOG = logging.getLogger(__name__)


def _projection(kubeconfig, template):
    result = subprocess.run(
        [
            "kubectl",
            "--kubeconfig",
            str(kubeconfig),
            "config",
            "view",
            "--raw",
            "-o",
            "jsonpath=" + template,
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    if result.returncode or len(result.stdout.encode()) > 262144:
        raise ValueError("Local public cluster identity projection failed")
    return result.stdout.splitlines()


def resolve_context(kubeconfig, logical_context="k8s-01"):
    if logical_context != "k8s-01":
        raise ValueError("Only explicit logical target k8s-01 is reviewed")
    rows = _projection(
        kubeconfig, r'{range .contexts[*]}{.name}{"\t"}{.context.cluster}{"\n"}{end}'
    )
    selected = []
    for row in rows:
        fields = row.split("\t")
        if len(fields) != 2:
            raise ValueError("Malformed context metadata")
        if fields[0] in ALIASES:
            selected.append(fields)
    if not selected or any(row[1] != "k8s-01" for row in selected):
        raise ValueError("Missing, ambiguous or mismatched reviewed context alias")
    physical_context = (
        "k8s-01" if any(row[0] == "k8s-01" for row in selected) else "k8s-01-admin"
    )
    cluster_rows = _projection(
        kubeconfig,
        r'{range .clusters[*]}{.name}{"\t"}{.cluster.server}{"\t"}{.cluster.certificate-authority-data}{"\t"}{.cluster.insecure-skip-tls-verify}{"\t"}{.cluster.proxy-url}{"\t"}{.cluster.tls-server-name}{"\t"}{.cluster.certificate-authority}{"\n"}{end}',
    )
    targets = [
        row.split("\t") for row in cluster_rows if row.split("\t", 1)[0] == "k8s-01"
    ]
    if len(targets) != 1 or len(targets[0]) != 7:
        raise ValueError("Missing or ambiguous reviewed cluster identity")
    _, server, encoded_ca, insecure, proxy, tls_name, ca_file = targets[0]
    if (
        server != SERVER
        or insecure not in ["", "false"]
        or proxy
        or tls_name
        or ca_file
    ):
        raise ValueError("Cluster endpoint/TLS/proxy differs from reviewed identity")
    try:
        public_ca = base64.b64decode(encoded_ca, validate=True)
        der = ssl.PEM_cert_to_DER_cert(public_ca.decode("ascii"))
    except (ValueError, UnicodeError):
        raise ValueError("Embedded public CA is missing or invalid") from None
    if hashlib.sha256(der).hexdigest() != CA_DER_SHA256:
        raise ValueError("Cluster public CA fingerprint differs from reviewed identity")
    LOG.info(
        "Verified logical=%s physical=%s cluster=k8s-01 public identity",
        logical_context,
        physical_context,
    )
    return physical_context


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", choices=["k8s-01"], required=True)
    parser.add_argument("--kubeconfig", required=True)
    parser.add_argument(
        "--check-access",
        action="store_true",
        help="Read-only authorization preflight for staging bootstrap",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    physical = resolve_context(args.kubeconfig, args.context)
    if args.check_access:
        # SelfSubjectAccessReviews assess permission; no target resources are created.
        prefix = [
            "kubectl",
            "--kubeconfig",
            args.kubeconfig,
            "--context",
            physical,
            "--namespace",
            "davinci-sign-staging",
        ]
        for verb, resource in [
            ("get", "namespaces"),
            ("create", "namespaces"),
            ("get", "secrets"),
            ("create", "secrets"),
            ("patch", "deployments.apps"),
        ]:
            result = subprocess.run(
                prefix + ["auth", "can-i", verb, resource, "--quiet"],
                check=False,
                capture_output=True,
                timeout=30,
            )
            if result.returncode:
                raise ValueError(
                    "Staging authorization preflight failed (response suppressed)"
                )
        LOG.info("Staging bootstrap/deploy authorization preflight passed")


if __name__ == "__main__":
    main()
