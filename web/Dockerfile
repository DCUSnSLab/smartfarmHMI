# syntax=docker/dockerfile:1.7
# AIBootcamp web/Dockerfile 패턴 미러 — deps → dev → builder → prod

# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---- dev (hot reload) ----
FROM node:20-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development TZ=Asia/Seoul
RUN apk add --no-cache tzdata curl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ 이 비면 Git 이 디렉터리를 남기지 않아 아래 prod 단계의 COPY 가 깨진다.
# 실제로 GEN-1285 에서 public 의 마지막 파일을 지운 뒤 prod 빌드가 실패했다.
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- prod (standalone) ----
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Seoul NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache tzdata curl && adduser -S -u 10001 appuser
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER appuser
EXPOSE 3000
CMD ["node", "server.js"]
