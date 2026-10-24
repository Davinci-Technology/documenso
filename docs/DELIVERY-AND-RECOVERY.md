# Davinci Sign delivery and recovery

The production service remains `k8s-01`, namespace `davinci-sign-production`,
`https://sign.davincisolutions.ai`. This change proposes an isolated staging rung,
not a production release. Origin main initially had no Studio authority ladder.
The lead must resolve the recorded onboarding rule before changing delivery branches.

## Staging prerequisites

Use `staging` as the review base and `Davinci/Web-Apps/Davinci-Sign/staging` as
the branch job. `continuous-integration/jenkins/pr-merge` was observed on PR144
and PR143 (ERROR), and `continuous-integration/jenkins/branch` succeeded on
main/95. Staging discovery and successful deployment are not yet proven.
Jenkins needs Python3/PyYAML, its existing registry and kubeconfig credentials,
and the Copy Artifact plugin for future promotion. No new paid resource is needed.
The application image runs as UID1001; staging aligns its certificate group to1001.
Production certificate paths, stored encryption keys, OIDC references, sender
`Davinci AI Solutions`, and namespaced MinIO FQDN remain intact.

Staging uses its own PostgreSQL15 StatefulSet and MinIO with bounded emptyDir
volumes, fresh auth and
encryption keys, a test-only certificate, Mailpit SMTP and an internal webhook
sink. Never copy production data, signing certificates or provider credentials.
The bootstrap creates only missing secrets and refuses incomplete certificate/key
state; reruns preserve every existing key. A failed partial bootstrap requires
inspection; do not delete keys automatically.

`staging-sign.davincisolutions.ai` initially had no DNS record. The ingress carries
an external-dns hostname annotation; existing external-dns on k8s-01 watches
Ingress and manages this domain. The lead must verify DNS and the distinct
`davinci-sign-staging-tls` certificate become ready. The `default` storageClass
was observed on production's MinIO PVC, but staging deliberately creates no PVC
or paid managed disk. Synthetic staging data resets when its database/storage
pod is replaced. App-pod replacement and callback outages can still rehearse
queue recovery while those storage pods remain running; storage-pod durability
and production DR are not proven by this environment.

1. Preview `python3 tools/delivery/bootstrap-staging.py --context k8s-01 --kubeconfig KUBECONFIG`.
2. After review, add `--apply`; registry pull creation reads `REGISTRY_USERNAME`
   and `REGISTRY_TOKEN` from Jenkins credentials, never CLI values or dotenv.
3. Render `python3 tools/delivery/release.py render --context k8s-01 --kubeconfig KUBECONFIG --image davinciai.azurecr.io/davinci-sign@sha256:DIGEST`.
4. `release.py deploy` without `--apply` performs server validation. Add `--apply`
   only after prerequisites pass. Every mutating kubectl call uses explicit context
   and namespace. Both web and migration init-container receive the same digest.
5. Verify CNI policy enforcement: from the staging application network, PostgreSQL,
   MinIO, Mailpit and the sink must work; production DB, SMTP SendGrid587 and a
   public HTTPS destination must fail. Calico/Tigera is present, but manifest
   existence is not enforcement proof. The application additionally restricts
   webhook hosts to the sink hostname. Do this before synthetic send tests.
6. Smoke login, synthetic upload/sign/download, asynchronous mail capture,
   webhook delivery to `http://webhook-sink.davinci-sign-staging.svc.cluster.local:8080`,
   retry/reconciliation and pod-restart recovery. Inspect Mailpit only through
   `kubectl ... port-forward service/mailpit 8025:8025`; no public mail UI ingress.
7. `release.py record ... --job Davinci/Web-Apps/Davinci-Sign/staging --build NUMBER
   --source-checks-passed --apply` re-verifies rollout, both running image identities
   and public health before publishing release.json. It does not certify manual
   UAT, backup readiness or provider integration; record those separately.

The policy only restricts application/init egress. It permits ingress normally so
the ingress controller can reach the app. Mailpit has no SMTP relay configured.
The webhook sink discards payloads. Sink data is synthetic and disposable.

## Production selection and approval

main never builds an application image. It requires an explicit
`STAGING_RELEASE_BUILD` and retrieves release.json from the trusted staging job's
immutable numbered build. Never upload an arbitrary local record as trusted CI
provenance. Missing evidence, changed source tree/configuration, skipped checks,
incomplete consumers or digest mismatch fail closed. Jenkins artifact retention
is30builds: retain the selected build and registry image for the release/rollback
support period before older artifacts expire. Promotion depends on source-tree
identity, including delivery policy, even when a merge creates a new commit SHA.
The selected record must remain tied to a successful final staging Jenkins build;
the lead verifies that build result and reviewer/UAT results before release.

The stage-level Jenkins approval occurs before an executor is acquired. Approval
must follow the owner's explicit Studio ship decision; a merge or green CI alone
is not production authorization. Production retains its existing secret resources;
this pipeline does not regenerate or replace them. Provider verification public key
can be added separately under the existing secret key
`SENDGRID_WEBHOOK_VERIFICATION_KEY` → env
`NEXT_PRIVATE_SENDGRID_WEBHOOK_VERIFICATION_KEY`. This is the SendGrid Event
Webhook signing public key (base64 DER SPKI), not the SMTP API key. Without it,
`POST /api/webhooks/sendgrid` returns503 and cannot accept unauthenticated events.
Actual provider callback registration and real mail sends require release scope.

Production rendering, registry digest pull, migrations, readiness, running image
identity and read-only public health remain required at promotion. Image identity
comparison currently expects registry single-platform digest equality; fail and
review an index/platform mismatch instead of silently accepting it.

## Monitoring and recovery

Admin-authenticated `GET /api/operations/delivery` exposes sanitized delivery/queue
counts. Collect structured job/webhook/mail failure alert logs in the existing log
system without recipient addresses, document payloads, secret values or signatures.
Alert on aged pending work, terminal failures and rising bounce/drop/failed counts;
include environment, job/message ID, attempt/status and a link to the operational
screen. A sustained oldest-pending age beyond the app's maximum retry window is
an actionable symptom. Route to the existing service operator; no new paid system.
The lease is120s, heartbeat30s and sweep30s with30s–5min retry backoff. Recovery is
at-least-once: inspect receiver/provider event identity before manual replay.
Never replay the production HR/Meridian failures during generic smoke tests.

`recovery.py inventory --context k8s-01 --kubeconfig KUBECONFIG --environment production`
reads workload/PVC/backup-job metadata only. It explicitly does not prove backups.
Before production promotion, verify Azure PostgreSQL point-in-time restore retention
and latest restorable timestamp, perform a separate isolated restore, and verify
off-cluster MinIO object backup and retrieval. Existing single-pod MinIO with one
PVC is not a backup. Restore must demonstrate usable document metadata and original
PDFs together; database-only success is insufficient. Record RPO/RTO and restore
result before the release decision.

For synthetic staging only, `recovery.py backup --dump /secure/path/staging.dump ...`
and `restore-check --dump /secure/path/staging.dump ...` are dry runs by default.
`--apply` saves a0600dump (refuses overwrite), then restores to a new scratch DB,
checks migration and table presence, and drops it even after errors. This is a
schema/restore rehearsal, not a production recovery drill or signing UAT.

If staging rollout fails, retain its storage pods and inspect sanitized events/status. Redeploy
the previous approved digest with the same renderer; do not delete/recreate keys.
For production rollback, select the previous supported digest and its config,
check schema compatibility with already-applied migrations, then deploy it under
an explicit incident/release decision and verify health/image and document access.
`kubectl rollout undo` alone can leave the migration init image or schema wrong.
Image rollback never reverses database migrations. If schema incompatible, restore
the approved DB/object recovery point to a separate target first; do not overwrite
production in an automatic pipeline. Rollback of new staging is deletion of only
its namespace after preserving any required synthetic test evidence, by the lead.

Support image pins: staging PostgreSQL, Mailpit and callback sink registry tags
were resolved read-only with `docker buildx imagetools inspect` and pinned by
index digest. MinIO and mc are carried forward from the observed production pod
imageIDs on2026-10-23; both staging and future production manifests pin those
exact existing bytes. Release records include the complete support-image set
as well as the shared web/migration image. No MinIO upgrade is included.

## Production-matching database and regression gates

Azure metadata confirms production signing uses PostgreSQL15. Staging and the isolated CI sidecar use the verified PostgreSQL15 image digest. The source gate migrates a disposable loopback-only database and runs the delivery Playwright configuration against actual database, HTTP and SMTP listeners; Vitest is retained for pure library behavior. No production connection string or data is used.

Production database metadata reports seven-day point-in-time retention. This is configuration evidence, not a successful production restore drill. Production high availability is currently disabled; enabling it or adding durable cloud staging storage requires a concrete cost decision.

## Explicit cluster identity before operations

CLI `--context k8s-01` is the logical reviewed target. The shared resolver selects
the explicitly named `k8s-01` context when present, otherwise the verified
`k8s-01-admin` CI alias. Both must map to cluster `k8s-01` when both are present. It never uses
current-context or copies/renames a kubeconfig. Every subsequent API operation
passes that verified physical context explicitly. Missing or conflicting aliases fail
closed; other unrelated kubeconfig contexts are ignored.

Before any API operation, local metadata must match the independently verified
Azure endpoint `https://k8s-01-dns-3l35exx4.hcp.canadacentral.azmk8s.io:443` and
public CA **DER** SHA256
`41d67224f5b8a393648f51ff37adcbd377b2778bef2ecf383991e52bd0b36916`.
This differs from a PEM-file-byte hash because PEM is an encoding of the DER
certificate. Insecure TLS, proxy override, TLS-name override, CA-file override,
wrong endpoint/CA and ambiguous aliases are rejected. No user/token/client-key
fields are projected or printed. The test fixture contains only this public CA,
not a kubeconfig or authentication credential. Planned cluster/CA rotation needs
a separately reviewed identity update; there is no automatic fallback.

Only staging binds the existing kubeconfig in the new preflight stage before
Kaniko. That stage checks local identity and read-only SelfSubjectAccessReview
permissions for bootstrap/deploy. PRs skip it before agent allocation and bind no
cluster credential. Source tests install a kubectl client solely for actual local
synthetic-config projections; those tests contact no Kubernetes API and cannot
execute an auth plugin. Bootstrap, release verify/deploy/record and recovery API
operations independently repeat the local identity gate. Offline render/select
and plan-only bootstrap/recovery remain offline.
