import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "release", Path(__file__).parents[1] / "release.py"
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
IMAGE = "davinciai.azurecr.io/davinci-sign@sha256:" + "a" * 64


@pytest.fixture
def record(monkeypatch):
    monkeypatch.setattr(release, "git", lambda *args: "tree")
    monkeypatch.setattr(release, "config_identity", lambda: "config")
    return {
        "schema": "davinci-sign-release/1",
        "source": "b" * 40,
        "tree": "tree",
        "config": "config",
        "image": IMAGE,
        "job": release.TRUSTED_JOB,
        "build": 1,
        "staging_url": "https://staging-sign.davincisolutions.ai",
        "consumers": ["app", "migrate"],
        "support_images": release.support_images(IMAGE),
        "checks": {
            "source": "passed",
            "rollout": "passed",
            "image": "passed",
            "smoke": "passed",
        },
    }


def test_exact_tested_release_selects(record):
    assert release.validate_release(record) == IMAGE


@pytest.mark.parametrize(
    "key,value",
    [
        ("schema", None),
        ("image", "davinciai.azurecr.io/davinci-sign:production"),
        ("image", "evil.example/sign@sha256:" + "a" * 64),
        ("job", "untrusted/staging"),
        ("build", 0),
        ("source", "short"),
        ("tree", "changed"),
        ("config", "changed"),
        ("consumers", ["app"]),
        ("support_images", {}),
        ("checks", {}),
        ("staging_url", "https://evil.example"),
    ],
)
def test_incomplete_moved_or_mismatched_release_refused(record, key, value):
    record[key] = value
    with pytest.raises(ValueError):
        release.validate_release(record)


@pytest.mark.parametrize("result", ["failed", "skipped", "unknown"])
def test_nonpassing_checks_refused(record, result):
    record["checks"]["smoke"] = result
    with pytest.raises(ValueError):
        release.validate_release(record)


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_every_app_consumer_renders_by_digest(environment):
    docs = release.manifests(environment, IMAGE)
    deployment = next(
        d
        for d in docs
        if d["kind"] == "Deployment" and d["metadata"]["name"] == "davinci-sign"
    )
    spec = deployment["spec"]["template"]["spec"]
    assert {
        c["name"]: c["image"]
        for c in [*spec["containers"], *spec["initContainers"]]
        if c["name"] in ["app", "migrate"]
    } == {"app": IMAGE, "migrate": IMAGE}
    assert all(d["kind"] != "Secret" for d in docs)
    assert all(
        d.get("metadata", {}).get("namespace", f"davinci-sign-{environment}")
        == f"davinci-sign-{environment}"
        for d in docs
    )


def test_staging_isolates_data_and_transports():
    docs = release.manifests("staging", IMAGE)
    config = next(d["data"] for d in docs if d["kind"] == "ConfigMap")
    assert config["DB_HOST"] == "postgres.davinci-sign-staging.svc.cluster.local"
    assert (
        config["NEXT_PRIVATE_UPLOAD_ENDPOINT"]
        == "http://minio.davinci-sign-staging.svc.cluster.local:9000"
    )
    assert (
        config["NEXT_PRIVATE_SMTP_HOST"]
        == "mailpit.davinci-sign-staging.svc.cluster.local"
    )
    assert (
        config["NEXT_PRIVATE_WEBHOOK_ALLOWED_HOSTS"]
        == "webhook-sink.davinci-sign-staging.svc.cluster.local"
    )
    assert not any("OIDC" in key for key in config)


def test_staging_does_not_provision_billable_disks():
    docs = release.manifests("staging", IMAGE)
    assert not any(doc["kind"] == "PersistentVolumeClaim" for doc in docs)
    for name in ["postgres", "minio"]:
        workload = next(
            doc
            for doc in docs
            if doc["kind"] == "StatefulSet" and doc["metadata"]["name"] == name
        )
        assert workload["spec"]["template"]["spec"]["volumes"] == [
            {"name": "data", "emptyDir": {"sizeLimit": "5Gi"}}
        ]
