#!/usr/bin/env bash
set -euo pipefail

# Ubuntu installer:
# - Node.js + npm
# - PostgreSQL
# - npm install
# - migrate
# - seed
# - pm2 start
#
# Usage:
#   sudo bash scripts/install-node-postgres-and-run.sh
#
# Optional env overrides:
#   APP_DIR=/opt/bitnami/AppFormUPSIEC
#   APP_USER=bitnami
#   DB_NAME=formupsiec
#   DB_USER=formapp_user
#   DB_PASS='strong-pass'
#   DB_HOST=127.0.0.1
#   DB_PORT=5432

APP_DIR="${APP_DIR:-/opt/bitnami/AppFormUPSIEC}"
APP_USER="${APP_USER:-bitnami}"
DB_NAME="${DB_NAME:-formupsiec}"
DB_USER="${DB_USER:-formapp_user}"
DB_PASS="${DB_PASS:-change-me}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

echo "==> [1/6] Installing Node.js + npm"
apt update
apt install -y curl ca-certificates gnupg lsb-release build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
npm -v

echo "==> [2/6] Installing PostgreSQL"
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql
sudo -u postgres psql -c "SELECT version();"

echo "==> [3/6] Creating PostgreSQL app user + database"
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
psql "postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}" -c "SELECT current_user, current_database();"

echo "==> [4/6] npm install"
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && npm install"

echo "==> [5/6] migrate + seed"
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && npm run db:migrate"
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && npm run db:seed"

echo "==> [6/6] pm2 start"
npm install -g pm2
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && pm2 start ecosystem.config.js --env production"
sudo -u "${APP_USER}" pm2 save
pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" || true
sudo -u "${APP_USER}" pm2 status

echo "Done."
