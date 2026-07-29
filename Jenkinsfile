// smartfarmHMI — Jenkins Pipeline (스켈레톤, AIBootcamp Jenkinsfile 패턴 미러)
// - develop → smartfarmhmi-dev (dev 환경)
// - main    → smartfarmhmi     (운영 환경)
// - 그 외 브랜치는 Checkout 만 수행
//
// TODO(잡 등록 시):
// - Harbor 프로젝트 생성: smartfarmhmi-dev, smartfarmhmi
// - Jenkins credentials 등록: harbor-cred(레지스트리), kubeconfig(클러스터)
// - Multibranch Pipeline 잡 생성

pipeline {
    agent any

    options {
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    environment {
        REGISTRY = 'harbor.cu.ac.kr'
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
                    def sha = sh(returnStdout: true, script: 'git rev-parse --short HEAD').trim()
                    env.IMAGE_TAG = "${env.BUILD_NUMBER}-${sha}"
                }
            }
        }

        stage('Build & Push') {
            when { anyOf { branch 'develop'; branch 'main' } }
            steps {
                // TODO: withCredentials([usernamePassword(credentialsId: 'harbor-cred', ...)])
                sh '''
                    docker build -t $REGISTRY/$IMAGE_PREFIX/api:$IMAGE_TAG        --target prod api
                    docker build -t $REGISTRY/$IMAGE_PREFIX/web:$IMAGE_TAG        --target prod web
                    docker build -t $REGISTRY/$IMAGE_PREFIX/middleware:$IMAGE_TAG --target prod -f middleware/Dockerfile .
                    docker build -t $REGISTRY/$IMAGE_PREFIX/edge-sim:$IMAGE_TAG                 -f edge-sim/Dockerfile .

                    # docker push $REGISTRY/$IMAGE_PREFIX/api:$IMAGE_TAG          # TODO: 로그인 후 활성화
                    # docker push $REGISTRY/$IMAGE_PREFIX/web:$IMAGE_TAG
                    # docker push $REGISTRY/$IMAGE_PREFIX/middleware:$IMAGE_TAG
                    # docker push $REGISTRY/$IMAGE_PREFIX/edge-sim:$IMAGE_TAG
                '''
            }
        }

        stage('Deploy') {
            when { anyOf { branch 'develop'; branch 'main' } }
            steps {
                // TODO: withCredentials([file(credentialsId: 'kubeconfig', variable: 'KUBECONFIG')])
                sh '''
                    cd deploy/k8s/overlays/$OVERLAY
                    kubectl kustomize . > /dev/null   # 렌더 검증

                    # 이미지 태그 치환 후 적용 (TODO: kubeconfig 등록 후 활성화)
                    # kustomize edit set image \
                    #   harbor.cu.ac.kr/smartfarmhmi-dev/api=$REGISTRY/$IMAGE_PREFIX/api:$IMAGE_TAG \
                    #   harbor.cu.ac.kr/smartfarmhmi-dev/middleware=$REGISTRY/$IMAGE_PREFIX/middleware:$IMAGE_TAG \
                    #   harbor.cu.ac.kr/smartfarmhmi-dev/edge-sim=$REGISTRY/$IMAGE_PREFIX/edge-sim:$IMAGE_TAG \
                    #   harbor.cu.ac.kr/smartfarmhmi-dev/web=$REGISTRY/$IMAGE_PREFIX/web:$IMAGE_TAG
                    # kubectl delete job smartfarmhmi-api-migrate -n $NAMESPACE --ignore-not-found
                    # kubectl apply -k . -n $NAMESPACE
                '''
            }
        }
    }
}
