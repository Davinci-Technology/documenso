import importlib.util
import re
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


def test_ci_image_digest_pins_are_valid_oci_sha256():
    pipeline = (release.ROOT / "Jenkinsfile").read_text()
    images = re.findall(r"(?m)^\s*image:\s*(\S+)", pipeline)
    assert images
    pinned = [image for image in images if "@" in image]
    assert pinned
    for image in pinned:
        assert re.fullmatch(r"[^@]+@sha256:[0-9a-f]{64}", image), image


@pytest.mark.parametrize(
    "stage_name",
    [
        "Source checks",
        "Build staging release once",
        "Deploy and verify isolated staging",
        "Select tested production release",
        "Promote selected release to production",
    ],
)
def test_branch_conditions_are_evaluated_before_agent_allocation(stage_name):
    pipeline = (release.ROOT / "Jenkinsfile").read_text()
    stage = pipeline.split(f"stage('{stage_name}') {{", 1)[1].split(
        "        stage(", 1
    )[0]
    condition = stage.split("            when {", 1)[1].split("            agent {", 1)[
        0
    ]
    assert re.search(r"(?m)^\s*beforeAgent true\s*$", condition)


def test_production_approval_is_gated_before_input_without_removing_owner_gate():
    pipeline = (release.ROOT / "Jenkinsfile").read_text()
    stage = pipeline.split("stage('Promote selected release to production') {", 1)[1]
    condition = stage.split("            when {", 1)[1].split("            input {", 1)[
        0
    ]
    assert re.search(r"(?m)^\s*beforeInput true\s*$", condition)
    assert re.search(r"(?m)^\s*branch 'main'\s*$", condition)
    assert "            input {" in stage
    assert "ok 'Promote approved release'" in stage
    assert stage.index("            input {") < stage.index("            agent {")
