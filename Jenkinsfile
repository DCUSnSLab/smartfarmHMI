// smartfarmHMI — Jenkins Pipeline (AIBootcamp Jenkinsfile 패턴 미러)
// - develop → smartfarmhmi-dev (dev 환경)
// - main    → smartfarmhmi     (운영 환경)
// - 그 외 브랜치는 Checkout 만 수행
//
// 전제:
// - Harbor 프로젝트: smartfarmhmi-dev (develop) / smartfarmhmi (main, main 배포 전 생성)
// - Jenkins credential: HARBOR_CRED_ID (Harbor 계정, username/password)
// - kubectl: Jenkins 에이전트에 kubeconfig 가 이미 설정돼 있다는 전제 (AIBootcamp 와 동일)
// - 클러스터 노드는 Harbor 에 로그인돼 있어 imagePullSecret 불필요

pipeline {
    agent any

    options {
        timeout(time: 40, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    environment {
        REGISTRY       = 'harbor.cu.ac.kr'
        HARBOR_CRED_ID = 'harbor'   // Jenkins Credentials 의 ID. 다르면 여기만 고친다.
        // IMAGE_PREFIX / NAMESPACE / OVERLAY / IMAGE_TAG 는 '환경 결정' 스테이지에서 set.
        // IMAGE_TAG = BUILD_NUMBER-GIT_SHA — 잡 재생성으로 BUILD_NUMBER 가 초기화돼도
        // 커밋 SHA 가 달라 기존 태그를 덮어쓰지 않는다 (불변성).
    }

    stages {

        stage('Checkout') {
            steps { checkout scm }
        }

        stage('환경 결정') {
            when { anyOf { branch 'develop'; branch 'main' } }
            steps {
                script {
                    if (env.BRANCH_NAME == 'main') {
                        env.IMAGE_PREFIX = 'smartfarmhmi'
                        env.NAMESPACE    = 'smartfarmhmi'
                        env.OVERLAY      = 'main'
                    } else {
                        env.IMAGE_PREFIX = 'smartfarmhmi-dev'
                        env.NAMESPACE    = 'smartfarmhmi-dev'
                        env.OVERLAY      = 'dev'
                    }
                    def sha = sh(returnStdout: true, script: 'git rev-parse --short=7 HEAD').trim()
                    env.IMAGE_TAG = "${env.BUILD_NUMBER}-${sha}"
                    echo "branch=${env.BRANCH_NAME} prefix=${env.IMAGE_PREFIX} ns=${env.NAMESPACE} overlay=${env.OVERLAY} tag=${env.IMAGE_TAG}"
                }
            }
        }

        stage('Build & Push') {
            when { anyOf { branch 'develop'; branch 'main' } }
            parallel {
                stage('api') {
                    steps {
                        script {
                            def img = docker.build("${REGISTRY}/${IMAGE_PREFIX}/api:${IMAGE_TAG}",
                                                   "--target prod ./api")
                            docker.withRegistry("https://${REGISTRY}", "${HARBOR_CRED_ID}") {
                                img.push()
                                img.push('latest')
                            }
                        }
                    }
                }
                stage('web') {
                    steps {
                        script {
                            // web 은 API 를 상대 경로(/api/...)로 호출하므로 NEXT_PUBLIC_* 빌드 인자가 없다.
                            // 런타임 값(DJANGO_SECRET_KEY)은 k8s Secret 으로 주입된다.
                            def img = docker.build("${REGISTRY}/${IMAGE_PREFIX}/web:${IMAGE_TAG}",
                                                   "--target prod ./web")
                            docker.withRegistry("https://${REGISTRY}", "${HARBOR_CRED_ID}") {
                                img.push()
                                img.push('latest')
                            }
                        }
                    }
                }
                stage('middleware') {
                    steps {
                        script {
                            // shared/ 를 포함해야 해서 루트 컨텍스트 (-f 로 Dockerfile 지정)
                            def img = docker.build("${REGISTRY}/${IMAGE_PREFIX}/middleware:${IMAGE_TAG}",
                                                   "--target prod -f middleware/Dockerfile .")
                            docker.withRegistry("https://${REGISTRY}", "${HARBOR_CRED_ID}") {
                                img.push()
                                img.push('latest')
                            }
                        }
                    }
                }
                stage('virtual-edge') {
                    steps {
                        script {
                            def img = docker.build("${REGISTRY}/${IMAGE_PREFIX}/virtual-edge:${IMAGE_TAG}",
                                                   "./virtual-edge")
                            docker.withRegistry("https://${REGISTRY}", "${HARBOR_CRED_ID}") {
                                img.push()
                                img.push('latest')
                            }
                        }
                    }
                }
            }
        }

        stage('Deploy') {
            when { anyOf { branch 'develop'; branch 'main' } }
            steps {
                dir("deploy/k8s/overlays/${OVERLAY}") {
                    sh """
                        set -e

                        # Job 완료 대기 헬퍼 — 실패 시 timeout 까지 매달리지 않고 즉시 중단하고
                        # events/log 를 덤프한다 (kubectl wait --for=complete 는 Failed 를 못 봐서
                        # backoffLimit 소진 후에도 timeout 을 꽉 채운다).
                        wait_job() {
                            j=\$1; limit=\$2; end=\$(( \$(date +%s) + limit ))
                            while : ; do
                                c=\$(kubectl get job/\$j -n ${NAMESPACE} -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || true)
                                f=\$(kubectl get job/\$j -n ${NAMESPACE} -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || true)
                                if [ "\$c" = "True" ]; then echo "[\$j] 완료"; return 0; fi
                                if [ "\$f" = "True" ]; then
                                    echo "[\$j] 실패 — 진단(events/log):"
                                    kubectl describe job/\$j -n ${NAMESPACE} | tail -25 || true
                                    kubectl logs job/\$j -n ${NAMESPACE} --tail=120 2>/dev/null \\
                                        || echo "(backoff 로 파드 삭제돼 로그 없음 — 위 events 참고)"
                                    return 1
                                fi
                                if [ \$(date +%s) -ge \$end ]; then
                                    echo "[\$j] 타임아웃(\${limit}s)"
                                    kubectl describe job/\$j -n ${NAMESPACE} | tail -25 || true
                                    return 1
                                fi
                                sleep 5
                            done
                        }

                        # 이미지 태그 교체 (latest → BUILD_NUMBER-GIT_SHA).
                        # newTag 값을 따옴표로 감싸 YAML 파서가 string 으로 읽게 한다
                        # (인용 없는 숫자만 들어가면 정수로 해석돼 Kustomize unmarshal 실패).
                        sed -i 's|newTag: latest|newTag: "${IMAGE_TAG}"|g' kustomization.yaml

                        # ── (0) 인프라(ConfigMap/StatefulSet/Service) 먼저 + Ready 대기
                        #       fresh 네임스페이스에서 DB 보다 마이그레이션 Job 이 먼저 돌면
                        #       접속 실패로 backoffLimit 을 소진한다.
                        #       ConfigMap 을 여기 포함하는 게 중요하다 — timescaledb 가
                        #       smartfarmhmi-db-init(초기화 스크립트)을 volume 으로 마운트하므로
                        #       ConfigMap 이 없으면 Pod 가 ContainerCreating 에서 영영 멈춘다
                        #       (AIBootcamp postgres 는 ConfigMap 을 안 붙여 이 순서로 문제없었다).
                        kubectl kustomize . \\
                            | awk 'BEGIN{RS="\\n---\\n"; ORS="\\n---\\n"} /(^|\\n)kind: (ConfigMap|StatefulSet|Service)\\n/' \\
                            | kubectl apply -n ${NAMESPACE} -f -
                        kubectl rollout status statefulset/timescaledb -n ${NAMESPACE} --timeout=5m
                        kubectl rollout status statefulset/redis       -n ${NAMESPACE} --timeout=5m
                        kubectl rollout status statefulset/minio       -n ${NAMESPACE} --timeout=5m

                        # ── (1) 마이그레이션·초기화 Job (immutable → delete 후 재생성)
                        #       app 스키마는 Django, mw 스키마는 Alembic — 둘 다 필요하다.
                        kubectl delete job/smartfarmhmi-api-migrate \\
                                        job/smartfarmhmi-mw-migrate \\
                                        job/smartfarmhmi-minio-init \\
                                        -n ${NAMESPACE} --ignore-not-found
                        kubectl kustomize . \\
                            | awk 'BEGIN{RS="\\n---\\n"; ORS="\\n---\\n"} /(^|\\n)kind: (ConfigMap|Job)\\n/' \\
                            | kubectl apply -n ${NAMESPACE} -f -
                        wait_job smartfarmhmi-api-migrate 900
                        wait_job smartfarmhmi-mw-migrate  900
                        wait_job smartfarmhmi-minio-init  300

                        # ── (2) 나머지 워크로드
                        kubectl apply -k .

                        # ── (3) 롤아웃 완료 대기
                        kubectl rollout status deploy/smartfarmhmi-api        -n ${NAMESPACE} --timeout=5m
                        kubectl rollout status deploy/smartfarmhmi-api-bridge -n ${NAMESPACE} --timeout=5m
                        kubectl rollout status deploy/smartfarmhmi-middleware -n ${NAMESPACE} --timeout=5m
                        kubectl rollout status deploy/smartfarmhmi-web        -n ${NAMESPACE} --timeout=5m
                        kubectl rollout status deploy/smartfarmhmi-nginx      -n ${NAMESPACE} --timeout=5m

                        echo "Gateway NodePort: \$(kubectl get svc smartfarmhmi-nginx -n ${NAMESPACE} -o jsonpath='{.spec.ports[0].nodePort}')"
                    """
                }
            }
        }
    }
}
