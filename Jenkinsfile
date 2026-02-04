// Mirror registry for base images (avoids Docker Hub rate limits)
def MIRROR_REGISTRY = 'davinciai.azurecr.io/mirror'

pipeline {
    agent none  // Use per-stage pod agents for K8s dynamic scaling

    options {
        buildDiscarder(logRotator(numToKeepStr: '20'))
        timeout(time: 60, unit: 'MINUTES')
        withFolderProperties()  // Inherit REGISTRY_HOSTNAME, REGISTRY_USERNAME from Davinci folder
    }

    triggers {
        githubPush()
    }

    environment {
        // Production namespace
        NAMESPACE = 'davinci-sign-production'

        // Image configuration
        IMAGE_NAME = 'davinci-sign'

        // Git credential
        GIT_CREDENTIAL_ID = 'f1b484af-24eb-4f28-a57a-66db51117a73'

        // Kubeconfig credential
        KUBECONFIG_CREDENTIAL_ID = 'cd3307d1-f27a-45b4-ad79-ee227bd802c6'

        // Mirror registry
        MIRROR_REGISTRY = 'davinciai.azurecr.io/mirror'
    }

    stages {
        stage('Checkout') {
            agent {
                kubernetes {
                    yaml """
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: jnlp
    image: ${MIRROR_REGISTRY}/jenkins-inbound-agent:3345.v03dee9b_f88fc-6
    resources:
      requests:
        memory: "256Mi"
        cpu: "100m"
"""
                }
            }
            steps {
                // Add GitHub host keys before checkout
                sh '''
                    mkdir -p ~/.ssh
                    ssh-keyscan -t rsa,ecdsa,ed25519 github.com > ~/.ssh/known_hosts 2>/dev/null
                    chmod 600 ~/.ssh/known_hosts
                '''
                checkout([
                    $class: 'GitSCM',
                    branches: scm.branches,
                    extensions: scm.extensions,
                    userRemoteConfigs: [[
                        url: scm.userRemoteConfigs[0].url,
                        credentialsId: env.GIT_CREDENTIAL_ID
                    ]]
                ])
                script {
                    env.IMAGE_TAG = "${BUILD_NUMBER}-${GIT_COMMIT.take(7)}"
                }
                stash includes: '**', name: 'source'
            }
        }

        stage('Parallel CI') {
            parallel {
                stage('Lint') {
                    agent {
                        kubernetes {
                            yaml """
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: node
    image: ${MIRROR_REGISTRY}/node:22-alpine
    command: ['sleep', '9999']
    resources:
      requests:
        memory: "1Gi"
        cpu: "500m"
      limits:
        memory: "2Gi"
        cpu: "1000m"
"""
                        }
                    }
                    steps {
                        unstash 'source'
                        container('node') {
                            sh '''
                                apk add --no-cache openssl
                                npm ci
                                npm run lint
                            '''
                        }
                    }
                }

                stage('Build Check') {
                    agent {
                        kubernetes {
                            yaml """
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: node
    image: ${MIRROR_REGISTRY}/node:22-alpine
    command: ['sleep', '9999']
    env:
    - name: NEXT_PRIVATE_ENCRYPTION_KEY
      value: "0000000000000000000000000000000000000000000000000000000000000000"
    - name: NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY
      value: "1111111111111111111111111111111111111111111111111111111111111111"
    resources:
      requests:
        memory: "4Gi"
        cpu: "1000m"
      limits:
        memory: "8Gi"
        cpu: "2000m"
"""
                        }
                    }
                    steps {
                        unstash 'source'
                        container('node') {
                            sh '''
                                apk add --no-cache openssl libc6-compat jq
                                npm ci
                                npm run translate:compile
                                npm run build
                            '''
                        }
                    }
                }
            }
        }

        stage('Build Docker Image') {
            when {
                branch 'main'
            }
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
      requests:
        memory: "4Gi"
        cpu: "1000m"
      limits:
        memory: "8Gi"
        cpu: "2000m"
'''
                }
            }
            steps {
                unstash 'source'
                withCredentials([
                    string(credentialsId: 'REGISTRY_TOKEN', variable: 'REGISTRY_TOKEN')
                ]) {
                    container('kaniko') {
                        sh '''
                            # Create docker config for Kaniko
                            mkdir -p /kaniko/.docker
                            AUTH=$(echo -n "${REGISTRY_USERNAME}:${REGISTRY_TOKEN}" | base64 | tr -d '\\n')
                            cat > /kaniko/.docker/config.json << EOF
{
    "auths": {
        "${REGISTRY_HOSTNAME}": {
            "auth": "${AUTH}"
        }
    }
}
EOF
                            # Build and push Davinci Sign image
                            /kaniko/executor \
                                --context=. \
                                --dockerfile=./docker/Dockerfile \
                                --destination=${REGISTRY_HOSTNAME}/${IMAGE_NAME}:${IMAGE_TAG} \
                                --destination=${REGISTRY_HOSTNAME}/${IMAGE_NAME}:production \
                                --cache=true \
                                --cache-ttl=168h \
                                --cache-repo=${REGISTRY_HOSTNAME}/${IMAGE_NAME}-cache
                        '''
                    }
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            agent {
                kubernetes {
                    yaml """
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: kubectl
    image: ${MIRROR_REGISTRY}/alpine-k8s:1.32.11
    command: [cat]
    tty: true
    resources:
      requests:
        memory: "256Mi"
        cpu: "100m"
      limits:
        memory: "512Mi"
        cpu: "500m"
"""
                }
            }
            steps {
                unstash 'source'
                withCredentials([
                    file(credentialsId: env.KUBECONFIG_CREDENTIAL_ID, variable: 'KUBECONFIG_FILE'),
                    string(credentialsId: 'davinci-sign-nextauth-secret', variable: 'NEXTAUTH_SECRET'),
                    string(credentialsId: 'davinci-sign-encryption-key', variable: 'ENCRYPTION_KEY'),
                    string(credentialsId: 'davinci-sign-encryption-key-2', variable: 'ENCRYPTION_KEY_2'),
                    string(credentialsId: 'davinci-sign-postgres-password', variable: 'POSTGRES_PASSWORD'),
                    string(credentialsId: 'davinci-sign-minio-password', variable: 'MINIO_PASSWORD'),
                    string(credentialsId: 'davinci-sign-smtp-password', variable: 'SMTP_PASSWORD'),
                    string(credentialsId: 'davinci-sign-cert-passphrase', variable: 'CERT_PASSPHRASE'),
                    file(credentialsId: 'davinci-sign-certificate-p12', variable: 'CERT_FILE')
                ]) {
                    container('kubectl') {
                        sh '''
                            export KUBECONFIG=${KUBECONFIG_FILE}
                            set -e  # Exit on first error

                            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                            echo "🚀 Deploying Davinci Sign to Production"
                            echo "  Namespace: ${NAMESPACE}"
                            echo "  Image Tag: ${IMAGE_TAG}"
                            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

                            # Verify cluster connection
                            kubectl cluster-info

                            # Create namespace if not exists
                            kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -

                            # Create/update secrets
                            echo "🔐 Creating secrets..."
                            kubectl create secret generic davinci-sign-secrets \
                                --namespace=${NAMESPACE} \
                                --from-literal=NEXTAUTH_SECRET="${NEXTAUTH_SECRET}" \
                                --from-literal=NEXT_PRIVATE_ENCRYPTION_KEY="${ENCRYPTION_KEY}" \
                                --from-literal=NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY="${ENCRYPTION_KEY_2}" \
                                --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
                                --from-literal=MINIO_ROOT_PASSWORD="${MINIO_PASSWORD}" \
                                --from-literal=NEXT_PRIVATE_UPLOAD_SECRET_ACCESS_KEY="${MINIO_PASSWORD}" \
                                --from-literal=NEXT_PRIVATE_SMTP_PASSWORD="${SMTP_PASSWORD}" \
                                --from-literal=NEXT_PRIVATE_SIGNING_PASSPHRASE="${CERT_PASSPHRASE}" \
                                --dry-run=client -o yaml | kubectl apply -f -

                            # Create certificate secret from file
                            kubectl create secret generic davinci-sign-certificate \
                                --namespace=${NAMESPACE} \
                                --from-file=cert.p12=${CERT_FILE} \
                                --dry-run=client -o yaml | kubectl apply -f -

                            # Apply K8s manifests
                            echo "📦 Applying Kubernetes manifests..."
                            kubectl apply -f k8s/production/namespace.yaml
                            kubectl apply -f k8s/production/configmap.yaml
                            kubectl apply -f k8s/production/minio-pvc.yaml
                            kubectl apply -f k8s/production/minio-statefulset.yaml
                            kubectl apply -f k8s/production/app-deployment.yaml
                            kubectl apply -f k8s/production/ingress.yaml
                            kubectl apply -f k8s/production/pdb.yaml

                            # Wait for MinIO to be ready
                            echo "⏳ Waiting for MinIO..."
                            kubectl rollout status statefulset/minio -n ${NAMESPACE} --timeout=3m || true

                            # Update image tag in deployment
                            echo "🔄 Updating image to ${IMAGE_TAG}..."
                            kubectl set image deployment/davinci-sign \
                                app=${REGISTRY_HOSTNAME}/${IMAGE_NAME}:${IMAGE_TAG} \
                                -n ${NAMESPACE}

                            # Wait for rollout
                            echo "⏳ Waiting for deployment rollout..."
                            kubectl rollout status deployment/davinci-sign -n ${NAMESPACE} --timeout=10m

                            # Health check verification
                            echo "🏥 Verifying health..."
                            HEALTH_OK=false
                            for i in $(seq 1 30); do
                                if kubectl exec deployment/davinci-sign -n ${NAMESPACE} -- \
                                    wget -q -O- http://localhost:3000/api/health 2>/dev/null | grep -q ok; then
                                    echo "✅ Health check passed"
                                    HEALTH_OK=true
                                    break
                                fi
                                echo "Waiting for health... ($i/30)"
                                sleep 10
                            done

                            if [ "$HEALTH_OK" != "true" ]; then
                                echo "❌ Health check failed - rolling back"
                                kubectl rollout undo deployment/davinci-sign -n ${NAMESPACE}
                                exit 1
                            fi

                            # Final verification
                            echo ""
                            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                            echo "✅ Deployment Complete!"
                            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                            echo ""
                            echo "Pod Status:"
                            kubectl get pods -n ${NAMESPACE}
                            echo ""
                            echo "🌐 URL: https://sign.davincisolutions.ai"
                        '''
                    }
                }
            }
        }
    }

    post {
        success {
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "✅ Pipeline Successful!"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        }
        failure {
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "❌ Pipeline Failed!"
            echo "Check the logs above for details."
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        }
    }
}
