#!/usr/bin/env python3
"""Explicit-target staging delivery and immutable release selection (dry run default)."""

import argparse
import hashlib
import json
import logging
import re
import subprocess
from pathlib import Path

import yaml
from cluster_identity import resolve_context

LOG = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[2]
IMAGE = re.compile(r"^davinciai\.azurecr\.io/davinci-sign@sha256:[0-9a-f]{64}$")
TRUSTED_JOB = "Davinci/Web-Apps/Davinci-Sign/staging"


def run(args, **kwargs):
    return subprocess.run(args, check=True, timeout=kwargs.pop("timeout", 90), **kwargs)


def git(*args):
    return run(
        ["git", "-c", f"safe.directory={ROOT}", "-C", str(ROOT), *args],
        capture_output=True,
        text=True,
    ).stdout.strip()


def config_identity():
    digest = hashlib.sha256()
    for path in sorted((ROOT / "k8s").rglob("*.yaml")):
        digest.update(str(path.relative_to(ROOT)).encode() + b"\0" + path.read_bytes())
    digest.update((ROOT / "tools/delivery/release.py").read_bytes())
    digest.update((ROOT / "Jenkinsfile").read_bytes())
    return digest.hexdigest()


def validate_release(record):
    if record.get("schema") != "davinci-sign-release/1":
        raise ValueError("Missing supported release schema")
    if not IMAGE.fullmatch(record.get("image", "")):
        raise ValueError(
            "Release must use the allowlisted repository and immutable digest"
        )
    if (
        record.get("job") != TRUSTED_JOB
        or type(record.get("build")) is not int
        or record["build"] < 1
    ):
        raise ValueError("Release must originate from the trusted staging job/build")
    if not re.fullmatch(r"[0-9a-f]{40}", record.get("source", "")):
        raise ValueError("Full source commit identity is required")
    if record.get("checks") != {
        "source": "passed",
        "rollout": "passed",
        "image": "passed",
        "smoke": "passed",
    }:
        raise ValueError("Every required staging result must be passed")
    if record.get("tree") != git("rev-parse", "HEAD^{tree}"):
        raise ValueError("Source tree differs from tested staging release")
    if record.get("config") != config_identity():
        raise ValueError("Deployment/test policy differs from tested staging release")
    if record.get("support_images") != support_images(record["image"]):
        raise ValueError("Support image set differs from tested configuration")
    if record.get("consumers") != ["app", "migrate"]:
        raise ValueError("Incomplete application image consumer set")
    if record.get("staging_url") != "https://staging-sign.davincisolutions.ai":
        raise ValueError("Untrusted staging target")
    return record["image"]


def manifests(environment, image):
    if not IMAGE.fullmatch(image):
        raise ValueError("A registry digest is mandatory; mutable tags are refused")
    folder = ROOT / "k8s" / environment
    docs = []
    for path in sorted(folder.glob("*.yaml")):
        # Secrets are provisioned separately and never rendered into CI artifacts.
        if path.name == "secrets.yaml":
            continue
        docs.extend(yaml.safe_load_all(path.read_text()))
    for doc in docs:
        if not doc:
            continue
        if (
            doc.get("metadata", {}).get("namespace", f"davinci-sign-{environment}")
            != f"davinci-sign-{environment}"
        ):
            raise ValueError("Cross-namespace resource refused")
        if doc["kind"] == "Deployment" and doc["metadata"]["name"] == "davinci-sign":
            spec = doc["spec"]["template"]["spec"]
            consumers = [*spec["containers"], *spec.get("initContainers", [])]
            for consumer in consumers:
                if consumer["name"] in ["app", "migrate"]:
                    consumer["image"] = image
    if environment == "staging":
        if any(doc and doc["kind"] == "PersistentVolumeClaim" for doc in docs):
            raise ValueError("Staging may not provision paid persistent disks")
        config = next(doc["data"] for doc in docs if doc and doc["kind"] == "ConfigMap")
        expected = {
            "DB_HOST": "postgres.davinci-sign-staging.svc.cluster.local",
            "NEXT_PRIVATE_UPLOAD_ENDPOINT": "http://minio.davinci-sign-staging.svc.cluster.local:9000",
            "NEXT_PRIVATE_SMTP_HOST": "mailpit.davinci-sign-staging.svc.cluster.local",
            "NEXT_PRIVATE_WEBHOOK_ALLOWED_HOSTS": "webhook-sink.davinci-sign-staging.svc.cluster.local",
        }
        if any(config.get(key) != value for key, value in expected.items()):
            raise ValueError("Staging transport/data isolation contract violated")
    return [doc for doc in docs if doc]


def support_images(image):
    images = {}
    for environment in ["staging", "production"]:
        for doc in manifests(environment, image):
            template = doc.get("spec", {}).get("template", {}).get("spec", {})
            for container in [
                *template.get("containers", []),
                *template.get("initContainers", []),
            ]:
                if container["image"] != image:
                    images[
                        f"{environment}/{doc['metadata']['name']}/{container['name']}"
                    ] = container["image"]
    return images


def kubectl(args, *command, **kwargs):
    return run(
        [
            "kubectl",
            "--kubeconfig",
            args.kubeconfig,
            "--context",
            args.resolved_context,
            "--namespace",
            f"davinci-sign-{args.environment}",
            *command,
        ],
        **kwargs,
    )


def verify(args, image):
    for resource in [
        "statefulset/minio",
        *(
            ["statefulset/postgres", "deployment/mailpit", "deployment/webhook-sink"]
            if args.environment == "staging"
            else []
        ),
        "deployment/davinci-sign",
    ]:
        kubectl(args, "rollout", "status", resource, "--timeout=600s", timeout=620)
    deployment = json.loads(
        kubectl(
            args,
            "get",
            "deployment/davinci-sign",
            "-o",
            "json",
            capture_output=True,
            text=True,
        ).stdout
    )
    spec = deployment["spec"]["template"]["spec"]
    for consumer in [*spec["containers"], *spec["initContainers"]]:
        if consumer["name"] in ["app", "migrate"] and consumer["image"] != image:
            raise ValueError("A consumer is not configured with the selected digest")
    pods = json.loads(
        kubectl(
            args,
            "get",
            "pods",
            "-l",
            "app=davinci-sign",
            "-o",
            "json",
            capture_output=True,
            text=True,
        ).stdout
    )
    ready = [
        p
        for p in pods["items"]
        if not p["metadata"].get("deletionTimestamp")
        and any(
            c["type"] == "Ready" and c["status"] == "True"
            for c in p.get("status", {}).get("conditions", [])
        )
    ]
    if not ready:
        raise ValueError("No ready application pod")
    digest = image.split("@")[1]
    for pod in ready:
        statuses = [
            *pod["status"].get("containerStatuses", []),
            *pod["status"].get("initContainerStatuses", []),
        ]
        for name in ["app", "migrate"]:
            found = [s for s in statuses if s["name"] == name]
            if len(found) != 1 or not found[0].get("imageID", "").endswith(digest):
                raise ValueError(
                    f"Observed {name} image digest mismatch (platform digest differences require explicit review)"
                )
    url = f"https://{'staging-' if args.environment == 'staging' else ''}sign.davincisolutions.ai/api/health"
    result = run(
        ["curl", "--fail", "--silent", "--show-error", "--max-time", "30", url],
        capture_output=True,
        text=True,
    )
    if "ok" not in result.stdout.lower():
        raise ValueError("Public health response did not report ok")
    LOG.info(
        "Rollout, both image consumers, running image identity and public health passed"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action", choices=["render", "deploy", "verify", "record", "select"]
    )
    parser.add_argument(
        "--environment", choices=["staging", "production"], default="staging"
    )
    parser.add_argument("--context", required=True)
    parser.add_argument("--kubeconfig", required=True)
    parser.add_argument("--image")
    parser.add_argument("--release", default="release.json")
    parser.add_argument("--build", type=int)
    parser.add_argument("--job")
    parser.add_argument("--source-checks-passed", action="store_true")
    parser.add_argument(
        "--approval", help="production requires exact promote:<source SHA>"
    )
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if args.context != "k8s-01":
        raise ValueError("Only reviewed k8s-01 context is supported")
    LOG.info(
        "Target context=%s namespace=davinci-sign-%s action=%s apply=%s",
        args.context,
        args.environment,
        args.action,
        args.apply,
    )
    if args.environment == "production":
        record = json.loads(Path(args.release).read_text())
        image = validate_release(record)
        if (
            args.action in ["deploy", "record"]
            and args.approval != f"promote:{record['source']}"
        ):
            raise ValueError("Exact selected-release production approval is required")
        if args.action == "record":
            raise ValueError("Only staging may certify a release")
    else:
        image = args.image
        if not image or not IMAGE.fullmatch(image):
            raise ValueError("Explicit immutable image required")
    if args.action == "select":
        LOG.info("Validated selected release %s", image)
        return
    if args.action in ["deploy", "verify", "record"]:
        args.resolved_context = resolve_context(args.kubeconfig, args.context)
    rendered = yaml.safe_dump_all(manifests(args.environment, image), sort_keys=False)
    if args.action == "render":
        print(rendered, end="")
    elif args.action == "deploy":
        # Server validation runs even in preview. No secret is created or modified.
        kubectl(args, "apply", "--dry-run=server", "-f", "-", input=rendered, text=True)
        if args.apply:
            kubectl(args, "apply", "-f", "-", input=rendered, text=True)
            verify(args, image)
        else:
            LOG.info(
                "Dry run complete; use --apply after reviewed prerequisites are ready"
            )
    else:
        verify(args, image)
        if args.action == "record":
            if (
                not args.source_checks_passed
                or args.job != TRUSTED_JOB
                or not args.build
            ):
                raise ValueError(
                    "Passed source checks and trusted staging build identity are required"
                )
            record = {
                "schema": "davinci-sign-release/1",
                "source": git("rev-parse", "HEAD"),
                "tree": git("rev-parse", "HEAD^{tree}"),
                "config": config_identity(),
                "image": image,
                "consumers": ["app", "migrate"],
                "support_images": support_images(image),
                "job": args.job,
                "build": args.build,
                "staging_url": "https://staging-sign.davincisolutions.ai",
                "checks": {
                    "source": "passed",
                    "rollout": "passed",
                    "image": "passed",
                    "smoke": "passed",
                },
            }
            if args.apply:
                Path(args.release).write_text(json.dumps(record, indent=2) + "\n")
                LOG.info("Recorded passed staging evidence: %s", args.release)
            else:
                LOG.info("Verified; dry run does not publish a release record")


if __name__ == "__main__":
    main()
