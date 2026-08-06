# smartfarmHMI K8s 매니페스트

사내 온프레미스 Kubernetes 클러스터 배포용 매니페스트 (AIBootcamp `deploy/k8s` 패턴 미러).

> **상태: dev 운영 중** (2026-08-06 개통, GEN-1264). `http://<노드IP>:30480`
> develop 머지 후 Jenkins로 배포된다.
> main(운영) overlay 는 아직 미개통.

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
│   ├── minio-init.yaml         # 버킷 생성 Job (mc mb --ignore-existing, 멱등)
│   ├── mosquitto.yaml          # Deployment (배치·TLS·ACL 은 OPN-22)
│   ├── api.yaml                # Django+Channels Deployment + Service
│   ├── api-migrate.yaml        # Django 마이그레이션 Job (배포 전 1회)
│   ├── api-bridge.yaml         # MQTT→Channels 브리지 (단일 replica 전제)
│   ├── middleware.yaml         # FastAPI Deployment (단일 replica 전제) + Service
│   ├── mw-migrate.yaml         # Alembic 마이그레이션 Job (mw 스키마)
│   ├── virtual-edge.yaml       # 시뮬레이터 성주·진주 (실엣지 전환 시 파일째 제거)
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

# 외부 서비스 키 — 공공데이터포털 기상청 API 서비스키 (middleware 날씨 수집)
# 엔드포인트(apis.data.go.kr/...)는 공개 정보라 코드에 두고, 키만 여기로 분리한다.
kubectl create secret generic smartfarmhmi-external-secrets -n $NS \
  --from-literal=WEATHER_KEY='<공공데이터포털 서비스키>'
```

`overlays/*/config.env` 는 git 에 커밋된다. 비밀번호·서비스키·사내망 주소는 Secret 에, 그 외 환경별 값만 거기 둔다.
외부 API 는 URL 이 아니라 서비스키만 비밀이다.

비밀값 추가 시 — Secret 생성 → 매니페스트에서 `secretRef`/`secretKeyRef` 로 참조 → 위 목록에 항목 추가.
Secret 변경 후에는 `kubectl rollout restart deploy/<대상>` (실행 중 Pod 는 갱신되지 않는다).

### 3. 렌더 확인 / 적용

순서가 중요하다. fresh 네임스페이스에서 전부 한 번에 apply 하면 DB 가 뜨기 전에 마이그레이션 Job 이
먼저 돌아 `backoffLimit` 을 소진한다.

```bash
NS=smartfarmhmi-dev
kubectl kustomize deploy/k8s/overlays/dev     # 렌더 확인

# (0) 인프라 먼저 — ConfigMap/StatefulSet/Service 를 추출해 적용 후 Ready 대기
#     ConfigMap 을 빠뜨리면 timescaledb 가 init 스크립트 ConfigMap 을 마운트하지 못해
#     ContainerCreating 에서 멈춘다.
kubectl kustomize deploy/k8s/overlays/dev \
  | awk 'BEGIN{RS="\n---\n"; ORS="\n---\n"} /(^|\n)kind: (ConfigMap|StatefulSet|Service)\n/' \
  | kubectl apply -n $NS -f -
kubectl rollout status statefulset/timescaledb -n $NS --timeout=5m
kubectl rollout status statefulset/redis       -n $NS --timeout=5m
kubectl rollout status statefulset/minio       -n $NS --timeout=5m

# (1) 마이그레이션·초기화 Job (immutable → delete 후 재생성)
kubectl delete job/smartfarmhmi-api-migrate job/smartfarmhmi-mw-migrate \
                  job/smartfarmhmi-minio-init -n $NS --ignore-not-found
kubectl kustomize deploy/k8s/overlays/dev \
  | awk 'BEGIN{RS="\n---\n"; ORS="\n---\n"} /(^|\n)kind: (ConfigMap|Job)\n/' \
  | kubectl apply -n $NS -f -
kubectl wait --for=condition=complete job/smartfarmhmi-api-migrate -n $NS --timeout=10m
kubectl wait --for=condition=complete job/smartfarmhmi-mw-migrate  -n $NS --timeout=10m

# (2) 나머지 워크로드
kubectl apply -k deploy/k8s/overlays/dev
kubectl rollout status deploy/smartfarmhmi-api        -n $NS --timeout=5m
kubectl rollout status deploy/smartfarmhmi-api-bridge -n $NS --timeout=5m
kubectl rollout status deploy/smartfarmhmi-middleware -n $NS --timeout=5m
kubectl rollout status deploy/smartfarmhmi-web        -n $NS --timeout=5m
kubectl rollout status deploy/smartfarmhmi-nginx      -n $NS --timeout=5m

echo "접속: http://<node-ip>:$(kubectl get svc smartfarmhmi-nginx -n $NS -o jsonpath='{.spec.ports[0].nodePort}')"
```

### 4. 배포 후 1회성 — 시드 데이터

```bash
kubectl exec -n $NS deploy/smartfarmhmi-middleware -- python -m middleware.scripts.seed
kubectl exec -n $NS deploy/smartfarmhmi-api        -- python manage.py seed_users
```

## 주의

- `base/mosquitto.conf`·`base/db-init-01-schemas.sh`·`base/vedge-*.yaml` 은 kustomize 로드 제한 때문에 둔 **사본**이다. 원본(`deploy/mosquitto/`, `deploy/timescaledb/init/`, `virtual-edge/configs/`) 변경 시 함께 갱신할 것.
- `api-migrate`·`mw-migrate`·`minio-init` Job 은 immutable — Jenkins 파이프라인이 apply 전에 delete 후 재생성한다.
- 마이그레이션은 **Django(app 스키마) + Alembic(mw 스키마) 둘 다** 필요하다 (`make migrate` 와 동일). 한쪽만 돌리면 반대편 서비스가 기동 직후 죽는다.
- middleware·api-bridge 는 MQTT 구독·스케줄러 특성상 **단일 replica 전제** — HPA 대상에 넣지 않는다. middleware 이미지의 uvicorn 도 같은 이유로 `--workers 1` 이다.
- PVC 의 `storageClassName: longhorn` 은 사내 클러스터 기준이다. SC 이름이 다르면 PVC 가 Pending 으로 영구 대기한다.
- web 은 라우트 가드(`web/src/middleware.ts`)가 JWT 를 직접 검증하므로 **api 와 같은 `DJANGO_SECRET_KEY`** 가 필요하다. 두 값이 어긋나면 로그인이 통과되지 않는다.
- 운영(main) overlay 의 TLS·HPA·도메인은 TODO — AIBootcamp `overlays/main` 참조해 도입. 쿠키 `secure` 전환(`api/apps/accounts/auth.py`)도 TLS 도입과 함께.
