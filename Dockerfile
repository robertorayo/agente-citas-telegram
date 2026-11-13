# Una sola imagen con los dos servicios: el motor (Node) en el puerto público y la API (Laravel) en 127.0.0.1.

# 1) Panel de React.
FROM node:22-bookworm-slim AS panel
WORKDIR /panel
COPY panel/package.json panel/package-lock.json ./
RUN npm ci
COPY panel/ ./
RUN npm run build

# 2) Motor de Node: se compila TypeScript y se quedan solo las dependencias de producción.
FROM node:22-bookworm-slim AS motor
WORKDIR /motor
COPY motor/package.json motor/package-lock.json ./
RUN npm ci
COPY motor/tsconfig.json ./
COPY motor/src ./src
RUN npm run build && npm prune --omit=dev

# 3) Imagen final: FrankenPHP (PHP 8.4) con el binario de Node copiado de la imagen oficial.
FROM dunglas/frankenphp:1-php8.4-bookworm
RUN install-php-extensions pdo_pgsql intl opcache
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node

WORKDIR /app/api
# Primero las dependencias de PHP, para que Docker las reutilice si no cambian.
COPY api/composer.json api/composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction
COPY api/ ./
RUN composer dump-autoload --optimize --no-dev && rm -f .env database/*.sqlite

COPY --from=motor /motor/dist /app/motor/dist
COPY --from=motor /motor/node_modules /app/motor/node_modules
COPY motor/package.json /app/motor/package.json
COPY motor/flujos /app/motor/flujos
COPY --from=panel /panel/dist /app/panel/dist
COPY web /app/web
COPY arrancar.sh /app/arrancar.sh

# FrankenPHP trae el permiso de abrir puertos bajos (cap_net_bind_service). Aquí escucha en el 8000 y sin root, así
# que se le quita: con ese permiso, en algunos entornos no arranca como usuario normal.
RUN apt-get update && apt-get install -y --no-install-recommends libcap2-bin && setcap -r /usr/local/bin/frankenphp \
    && apt-get purge -y libcap2-bin && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home app && chown -R app /app && chmod +x /app/arrancar.sh
USER app
# Caddy (dentro de FrankenPHP) guarda su estado en carpetas propias del usuario, no en los volúmenes de la imagen.
ENV APP_ENV=production APP_DEBUG=false LOG_CHANNEL=stderr SESSION_DRIVER=array QUEUE_CONNECTION=sync \
    CACHE_STORE=file DB_CONNECTION=pgsql HOST=0.0.0.0 NODE_ENV=production \
    XDG_CONFIG_HOME=/home/app/.config XDG_DATA_HOME=/home/app/.local/share
CMD ["/app/arrancar.sh"]
