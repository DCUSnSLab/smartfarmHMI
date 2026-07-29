# smartfarmHMI K8s 매니페스트

사내 온프레미스 Kubernetes 클러스터 배포용 매니페스트 (AIBootcamp `deploy/k8s` 패턴 미러).

> **상태: 스켈레톤.** `kubectl kustomize` 렌더 검증까지 완료된 상태이며, 실제 클러스터 적용·검증은 아직이다. 증분 1(스키마 구현) 이후 dev 클러스터 적용을 진행한다.

- 매니페스트 도구: **Kustomize** (kubectl 내장)
- 배포 흐름: Jenkins → Harbor(`harbor.cu.ac.kr`) push → `kubectl apply -k`
- 브랜치 매핑: **develop → `smartfarmhmi-dev`** / **main → `smartfarmhmi`** 네임스페이스

## 디렉토리 구조

```
deploy/k8s/
├── base/                       # 환경 공통
│   ├── timescaledb.yaml        # StatefulSet (init: app/mw 스키마·계정 생성)
│   ├── redis.yaml              # StatefulSet
│   ├── minio.yaml              # StatefulSet
│   ├── mosquitto.yaml          # Deployment (배치·TLS·ACL 은 OPN-22)
│   ├── api.yaml                # Django+Channels Deployment + Service
│   ├── api-migrate.yaml        # 배포 전 1회 Job
│   ├── middleware.yaml         # FastAPI Deployment (단일 replica 전제) + Service
│   ├── edge-sim.yaml           # 시뮬레이터 (실엣지 전환 시 제거)
│   ├── web.yaml                # Next.js Deployment + Service
│   ├── nginx.yaml + nginx.conf # 단일 진입점
│   └── kustomization.yaml
└── overlays/
    ├── dev/                    # namespace smartfarmhmi-dev · NodePort 30480
    └── main/                   # namespace smartfarmhmi · NodePort 30481 (TLS·HPA TODO)
```

## 최초 1회 사전 작업

### 1. Namespace

```bash
kubectl create namespace smartfarmhmi-dev    # dev
kubectl create namespace smartfarmhmi        # main
```

### 2. Secret 생성 (반드시 수동, git 미포함)

```bash
NS=smartfarmhmi-dev   # main 은 NS=smartfarmhmi 로 반복

# Django SECRET_KEY
kubectl create secret generic django-secret -n $NS \
  --from-literal=SECRET_KEY="$(openssl rand -base64 50 | tr -d '\n')"

# PostgreSQL — 슈퍼계정 + 서비스별 계정 비밀번호 (db-schema.md §1)
kubectl create secret generic postgres-credentials -n $NS \
  --from-literal=POSTGRES_DB=smartfarm \
  --from-literal=POSTGRES_USER=smartfarm \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -base64 24)" \
  --from-literal=APP_DB_PASSWORD="$(openssl rand -base64 24)" \
  --from-literal=MW_DB_PASSWORD="$(openssl rand -base64 24)"

# MinIO
kubectl create secret generic minio-credentials -n $NS \
  --from-literal=MINIO_ACCESS_KEY="$(openssl rand -hex 12)" \
  --from-literal=MINIO_SECRET_KEY="$(openssl rand -hex 24)"
```

### 3. 렌더 확인 / 적용

```bash
kubectl kustomize deploy/k8s/overlays/dev     # 렌더 확인
kubectl apply -k deploy/k8s/overlays/dev      # 적용 (Jenkins 가 수행)
```

## 주의

- `base/mosquitto.conf`·`base/db-init-01-schemas.sh` 는 kustomize 로드 제한 때문에 둔 **사본**이다. 원본(`deploy/mosquitto/`, `deploy/timescaledb/init/`) 변경 시 함께 갱신할 것.
- `api-migrate` Job 은 immutable — Jenkins 파이프라인이 apply 전에 delete 후 재생성한다.
- middleware 는 MQTT 구독·스케줄러 특성상 **단일 replica 전제** — HPA 대상에 넣지 않는다.
- 운영(main) overlay 의 TLS·HPA·도메인·리소스 limit 은 TODO — AIBootcamp `overlays/main` 참조해 도입.
