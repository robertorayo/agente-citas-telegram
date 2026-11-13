#!/bin/bash
# Arranque del contenedor: prepara Laravel, aplica las migraciones y lanza los dos procesos.
# Si cualquiera de los dos se cae, el contenedor termina y el hosting lo reinicia.
set -eu

PORT="${PORT:-3000}"
# Laravel avisa al motor por la red interna del contenedor.
export MOTOR_URL="http://127.0.0.1:${PORT}"
export API_URL="http://127.0.0.1:8000"
# La URL de PostgreSQL que da Neon (postgresql://...?sslmode=require) la entiende Laravel tal cual. Si es la del
# pooler («-pooler» en el host), se usa la conexión directa: el pooler (PgBouncer en modo transacción) rompe las
# migraciones de Laravel, que van dentro de una transacción. Un único proceso PHP no necesita pooler.
URL_BD="${DATABASE_URL:?Falta DATABASE_URL}"
export DB_URL="${URL_BD/-pooler./.}"
# Laravel necesita una clave de 32 bytes en base64. Se deriva de APP_SECRETO, que genera el hosting.
: "${APP_SECRETO:?Falta APP_SECRETO}"
export APP_KEY="base64:$(php -r 'echo base64_encode(hash("sha256", getenv("APP_SECRETO"), true));')"

cd /app/api
php artisan config:cache
php artisan route:cache
php artisan migrate --force

frankenphp php-server --root /app/api/public --listen 127.0.0.1:8000 &
node /app/motor/dist/index.js &

# Al apagar, el hosting manda SIGTERM a este script (PID 1): se reenvía a los dos procesos para que terminen lo
# que estén haciendo, en vez de que los mate de golpe.
trap 'kill -TERM $(jobs -p) 2>/dev/null; wait' TERM INT

# Espera a que termine cualquiera de los dos (wait -n es de bash) y sale con su código.
set +e
wait -n
codigo=$?
kill -TERM $(jobs -p) 2>/dev/null
exit $codigo
