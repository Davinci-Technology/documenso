// Source checks run on all branches. Only staging builds a release image.
// main selects a specific archived staging artifact; production never rebuilds.
pipeline {
    agent none
    options {
        buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '30'))
        timeout(time: 90, unit: 'MINUTES')
        disableConcurrentBuilds()
        withFolderProperties()
        skipDefaultCheckout(true)
    }
    triggers { githubPush() }
    parameters {
        string(name: 'STAGING_RELEASE_BUILD', defaultValue: '', description: 'Exact trusted staging build number for production promotion')
    }
    environment {
        IMAGE_NAME = 'davinci-sign'
        KUBECONFIG_CREDENTIAL_ID = 'cd3307d1-f27a-45b4-ad79-ee227bd802c6'
        STAGING_JOB = 'Davinci/Web-Apps/Davinci-Sign/staging'
    }
    stages {
        stage('Source checks') {
            when { not { branch 'main' } }
            agent {
                kubernetes {
                    yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: node
    image: node:24-alpine3.23
    command: ['sleep', '9999']
    resources:
      requests: {memory: 4Gi, cpu: '1'}
      limits: {memory: 10Gi, cpu: '2'}
  - name: postgres-tests
    image: postgres:15@sha256:baa22e6286bf832cb147b8bb5aa9d8bc999846d69c21d11bf63f58fbeed1fa48
    env:
    - {name: POSTGRES_DB, value: sign_delivery_test_ci}
    - {name: POSTGRES_HOST_AUTH_METHOD, value: trust}
    readinessProbe:
      exec: {command: [pg_isready, -U, postgres, -d, sign_delivery_test_ci]}
      initialDelaySeconds: 2
      periodSeconds: 2
    resources:
      requests: {memory: 128Mi, cpu: 100m}
      limits: {memory: 1Gi, cpu: '1'}
'''
                }
            }
            environment {
                NEXT_PRIVATE_DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/sign_delivery_test_ci'
                NEXT_PRIVATE_DIRECT_DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/sign_delivery_test_ci'
                SIGN_DELIVERY_TESTS = 'true'
                CI = 'true'
            }
            steps {
                checkout scm
                container('node') {
                    sh '''
                        set -eu
                        apk add --no-cache openssl libc6-compat python3 py3-pip py3-yaml jq make cmake g++ bash font-freefont
                        python3 -m venv /tmp/ops-tests
                        /tmp/ops-tests/bin/pip install -r tools/upstream-sync/requirements.txt pytest
                        /tmp/ops-tests/bin/python -m pytest tools/upstream-sync/tests/test_deterministic.py tools/upstream-sync/tests/test_sweep.py tools/upstream-sync/tests/test_validator_branding.py tools/delivery/tests -q
                        npm ci
                        npm run prisma:generate -w @documenso/prisma
                        npm run translate:compile
                        npx prisma migrate deploy --schema packages/prisma/schema.prisma
                        npm run test -w @documenso/lib
                        npm run build:server -w @documenso/remix
                        npm run test:dev -w @documenso/app-tests -- --config playwright.delivery.config.ts
                    '''
                }
            }
        }
        stage('Build staging release once') {
            when { branch 'staging' }
            agent {
                kubernetes {
                    yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: kaniko
    image: gcr.io/kaniko-project/executor:v1.23.2-debug
    command: ['sleep', '9999']
    resources:
      requests: {memory: 10Gi, cpu: '1'}
      limits: {memory: 16Gi, cpu: '2'}
'''
                }
            }
            steps {
                checkout scm
                withCredentials([string(credentialsId: 'REGISTRY_TOKEN', variable: 'REGISTRY_TOKEN')]) {
                    container('kaniko') {
                        sh '''
                            set -eu
                            set +x
                            mkdir -p /kaniko/.docker
                            AUTH=$(printf '%s' "${REGISTRY_USERNAME}:${REGISTRY_TOKEN}" | base64 | tr -d '\n')
                            printf '{"auths":{"%s":{"auth":"%s"}}}' "$REGISTRY_HOSTNAME" "$AUTH" > /kaniko/.docker/config.json
                            trap 'rm -f /kaniko/.docker/config.json' EXIT
                            /kaniko/executor --context=. --dockerfile=./docker/Dockerfile \
                              --destination="${REGISTRY_HOSTNAME}/${IMAGE_NAME}:staging-${BUILD_NUMBER}-${GIT_COMMIT}" \
                              --digest-file=image-digest.txt --cache=true --cache-ttl=168h \
                              --cache-repo="${REGISTRY_HOSTNAME}/${IMAGE_NAME}-cache" --single-snapshot
                        '''
                    }
                }
                stash name: 'image-digest', includes: 'image-digest.txt'
            }
        }
        stage('Deploy and verify isolated staging') {
            when { branch 'staging' }
            agent {
                kubernetes {
                    yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: kubectl
    image: alpine/k8s:1.35.0@sha256:18bc02c1e0df04451f4f9194eb7b7341c1165da5495459b52f85f72fb95450321
    command: ['sleep', '9999']
    resources:
      requests: {memory: 256Mi, cpu: 100m}
      limits: {memory: 512Mi, cpu: 500m}
'''
                }
            }
            steps {
                checkout scm
                unstash 'image-digest'
                withCredentials([
                    file(credentialsId: env.KUBECONFIG_CREDENTIAL_ID, variable: 'KUBECONFIG_FILE'),
                    string(credentialsId: 'REGISTRY_TOKEN', variable: 'REGISTRY_TOKEN')
                ]) {
                    container('kubectl') {
                        sh '''
                            set -eu
                            set +x
                            apk add --no-cache python3 py3-yaml openssl git curl
                            python3 tools/delivery/bootstrap-staging.py --context k8s-01 --kubeconfig "$KUBECONFIG_FILE" --apply
                            RELEASE_IMAGE="davinciai.azurecr.io/davinci-sign@$(cat image-digest.txt)"
                            python3 tools/delivery/release.py deploy --context k8s-01 --kubeconfig "$KUBECONFIG_FILE" --image "$RELEASE_IMAGE" --apply
                            python3 tools/delivery/release.py record --context k8s-01 --kubeconfig "$KUBECONFIG_FILE" --image "$RELEASE_IMAGE" --source-checks-passed --job "$STAGING_JOB" --build "$BUILD_NUMBER" --apply
                        '''
                    }
                }
                archiveArtifacts artifacts: 'release.json,image-digest.txt', fingerprint: true
            }
        }
        stage('Select tested production release') {
            when { branch 'main' }
            agent {
                kubernetes {
                    yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: kubectl
    image: alpine/k8s:1.35.0@sha256:18bc02c1e0df04451f4f9194eb7b7341c1165da5495459b52f85f72fb95450321
    command: ['sleep', '9999']
'''
                }
            }
            steps {
                checkout scm
                script {
                    if (!(params.STAGING_RELEASE_BUILD ==~ /[1-9][0-9]*/)) {
                        error('Select an exact verified STAGING_RELEASE_BUILD; production cannot rebuild or select latest')
                    }
                }
                // Copy Artifact plugin must be installed and staging must grant this job read access.
                copyArtifacts projectName: env.STAGING_JOB, selector: specific(params.STAGING_RELEASE_BUILD), filter: 'release.json,image-digest.txt'
                container('kubectl') {
                    sh '''
                        set -eu
                        apk add --no-cache python3 py3-yaml git curl
                        python3 tools/delivery/release.py select --environment production --context k8s-01 --kubeconfig /dev/null
                    '''
                    script {
                        env.RELEASE_SOURCE = sh(script: "python3 -c 'import json; print(json.load(open(\"release.json\"))[\"source\"])'", returnStdout: true).trim()
                    }
                }
                stash name: 'selected-release', includes: 'release.json,image-digest.txt'
            }
        }
        stage('Promote selected release to production') {
            when { branch 'main' }
            // Stage input is evaluated before acquiring an executor.
            input {
                message "Promote the exact verified staging build ${params.STAGING_RELEASE_BUILD} to sign.davincisolutions.ai? Requires the owner's release approval recorded through Studio ship."
                ok 'Promote approved release'
            }
            agent {
                kubernetes {
                    yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: kubectl
    image: alpine/k8s:1.35.0@sha256:18bc02c1e0df04451f4f9194eb7b7341c1165da5495459b52f85f72fb95450321
    command: ['sleep', '9999']
'''
                }
            }
            steps {
                checkout scm
                unstash 'selected-release'
                withCredentials([file(credentialsId: env.KUBECONFIG_CREDENTIAL_ID, variable: 'KUBECONFIG_FILE')]) {
                    container('kubectl') {
                        sh '''
                            set -eu
                            apk add --no-cache python3 py3-yaml git curl
                            python3 tools/delivery/release.py deploy --environment production --context k8s-01 --kubeconfig "$KUBECONFIG_FILE" --approval "promote:$RELEASE_SOURCE" --apply
                        '''
                    }
                }
            }
        }
    }
}
