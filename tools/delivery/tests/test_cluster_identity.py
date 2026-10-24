"""Actual local kubectl projections against synthetic configs, never a cluster API."""

import base64
import copy
import json
import sys
from pathlib import Path

import pytest
from cluster_identity import SERVER, resolve_context

PUBLIC_CA = (Path(__file__).parent / "fixtures/k8s-01-public-ca.txt").read_bytes()


def config(tmp_path, alias="k8s-01"):
    marker = tmp_path / "exec-was-invoked"
    value = {
        "apiVersion": "v1",
        "kind": "Config",
        "current-context": "unreviewed-current",
        "contexts": [
            {
                "name": alias,
                "context": {"cluster": "k8s-01", "user": "credential-sentinel"},
            },
            {"name": "unreviewed-current", "context": {"cluster": "other"}},
        ],
        "clusters": [
            {
                "name": "k8s-01",
                "cluster": {
                    "server": SERVER,
                    "certificate-authority-data": base64.b64encode(PUBLIC_CA).decode(),
                },
            },
            {"name": "other", "cluster": {"server": "https://unreviewed.invalid"}},
        ],
        "users": [
            {
                "name": "credential-sentinel",
                "user": {
                    "exec": {
                        "apiVersion": "client.authentication.k8s.io/v1",
                        "command": sys.executable,
                        "args": [
                            "-c",
                            f"from pathlib import Path; Path({str(marker)!r}).touch()",
                        ],
                        "interactiveMode": "Never",
                    },
                },
            }
        ],
    }
    return value, marker


def save(tmp_path, value):
    path = tmp_path / "synthetic-kubeconfig.json"
    path.write_text(json.dumps(value))
    path.chmod(0o600)
    return path


@pytest.mark.parametrize("alias", ["k8s-01", "k8s-01-admin"])
def test_actual_kubectl_selects_explicit_trusted_alias_without_using_current_or_exec(
    tmp_path, alias
):
    value, marker = config(tmp_path, alias)
    assert resolve_context(save(tmp_path, value)) == alias
    assert not marker.exists()


@pytest.mark.parametrize(
    "case",
    [
        "wrong-server",
        "wrong-ca",
        "missing-ca",
        "insecure",
        "proxy",
        "tls-name",
        "ca-file",
        "missing-alias",
        "ambiguous-alias",
        "wrong-cluster",
        "malformed-ca",
    ],
)
def test_actual_kubectl_rejects_unsafe_target_without_exec(tmp_path, case):
    value, marker = config(tmp_path)
    cluster = value["clusters"][0]["cluster"]
    if case == "wrong-server":
        cluster["server"] = "https://wrong.invalid"
    elif case == "wrong-ca":
        cluster["certificate-authority-data"] = base64.b64encode(
            b"-----BEGIN CERTIFICATE-----\nd3JvbmctY2E=\n-----END CERTIFICATE-----\n"
        ).decode()
    elif case == "missing-ca":
        del cluster["certificate-authority-data"]
    elif case == "insecure":
        cluster["insecure-skip-tls-verify"] = True
    elif case == "proxy":
        cluster["proxy-url"] = "https://proxy.invalid"
    elif case == "tls-name":
        cluster["tls-server-name"] = "other.invalid"
    elif case == "ca-file":
        cluster["certificate-authority"] = "/not-the-reviewed-ca"
    elif case == "missing-alias":
        value["contexts"] = value["contexts"][1:]
    elif case == "ambiguous-alias":
        other = copy.deepcopy(value["contexts"][0])
        other["name"] = "k8s-01-admin"
        other["context"]["cluster"] = "other"
        value["contexts"].append(other)
    elif case == "wrong-cluster":
        value["contexts"][0]["context"]["cluster"] = "other"
    else:
        cluster["certificate-authority-data"] = "%%%"
    with pytest.raises(ValueError):
        resolve_context(save(tmp_path, value))
    assert not marker.exists()


def test_wrong_logical_target_is_not_an_ambient_fallback(tmp_path):
    value, marker = config(tmp_path)
    with pytest.raises(ValueError):
        resolve_context(save(tmp_path, value), "unreviewed-current")
    assert not marker.exists()


def test_equivalent_explicit_aliases_prefer_requested_logical_name(tmp_path):
    value, marker = config(tmp_path)
    other = copy.deepcopy(value["contexts"][0])
    other["name"] = "k8s-01-admin"
    value["contexts"].append(other)
    assert resolve_context(save(tmp_path, value)) == "k8s-01"
    assert not marker.exists()


def test_missing_explicit_kubeconfig_cannot_use_ambient_default(tmp_path):
    with pytest.raises(ValueError):
        resolve_context(tmp_path / "absent-kubeconfig")
