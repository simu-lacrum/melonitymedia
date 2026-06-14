# Узел: VPS Infrastructure

**Тип**: Operations / Infrastructure

## Параметры подключения
- **IP**: `31.76.0.144`
- **User**: `root`
- **Auth**: SSH password через `SSH_ASKPASS` (`%TEMP%\sshpass.bat`)
- **Проект**: `/opt/melonitymedia`
- **Git remote**: `https://github.com/simu-lacrum/melonitymedia.git`

## Docker Compose Stack
- `melonitymedia-db-1` — PostgreSQL 16 (healthcheck)
- `melonitymedia-redis-1` — Redis 7 (healthcheck)
- `melonitymedia-api-1` — Express.js API (depends: db, redis)
- `melonitymedia-worker-1` — BullMQ + Patchright (healthcheck)
- `melonitymedia-web-1` — Next.js 15 (depends: api)
- `melonitymedia-nginx-1` — Reverse proxy (depends: web)

## Deployment Flow
1. `git push origin main` с локальной машины
2. SSH → `git fetch origin main && git reset --hard origin/main`
3. `docker compose build --no-cache <service>` (~8 мин для worker)
4. `docker compose up -d`

## Известные проблемы
- `failed to receive status: rpc error: EOF` — НЕ ошибка, билд OK
- `POSTGRES_PASSWORD not set` — warning, пароль в `.env`
- API/web могут Exited при пересборке worker — нужен `docker compose up -d`

## Связи
- Все сервисы деплоятся из одного docker-compose.yml
- Worker использует Chrome из `/opt/google/chrome/chrome`
- Node.js modules доступны только из `/app` директории в контейнере
