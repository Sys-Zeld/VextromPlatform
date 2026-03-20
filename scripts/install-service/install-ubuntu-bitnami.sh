#!/usr/bin/env bash
set -euo pipefail

# Instalacao APP-FORM-UPS-IEC em Ubuntu (Bitnami image)
# Uso:
#   sudo bash scripts/install-ubuntu-bitnami.sh
#
# Ajuste os valores abaixo antes de executar.

APP_DIR="/opt/vextrom/"
APP_USER="admin"
APP_GROUP="bitnami"
APP_PORT="3000"
APP_DOMAIN="seu-dominio.com"
APP_BASE_URL="https://seu-dominio.com"
REPO_URL="SEU_REPO_AQUI"

DB_NAME="formupsiec"
DB_USER="formapp_user"
DB_PASS="SENHA_FORTE_AQUI"
DB_HOST="127.0.0.1"
DB_PORT="5432"

ADMIN_USER="admin"
ADMIN_PASS="troque-essa-senha"
ADMIN_SESSION_SECRET="troque-para-um-segredo-longo"
API_KEY_PEPPER="troque-para-um-segredo-diferente"

USE_APACHE_PROXY="true" # true|false
USE_NGINX_PROXY="false" # true|false

echo "[1/12] Atualizando sistema e pacotes base..."
apt update && apt upgrade -y
apt install -y curl git ca-certificates gnupg lsb-release build-essential

echo "[2/12] Instalando Node.js (22.x) + npm..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
npm -v

echo "[3/12] Instalando PostgreSQL..."
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql
sudo -u postgres psql -c "SELECT version();"

echo "[4/12] Criando usuario/banco exclusivo no PostgreSQL..."
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

echo "[5/12] Criando usuario de deploy e pasta da aplicacao..."
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${APP_USER}"
fi
usermod -aG "${APP_GROUP}" "${APP_USER}"
mkdir -p "${APP_DIR}"
chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}"
chmod -R 2750 "${APP_DIR}"

echo "[6/12] Baixando codigo da aplicacao..."
if [ ! -d "${APP_DIR}/.git" ]; then
  sudo -u "${APP_USER}" git clone "${REPO_URL}" "${APP_DIR}"
else
  sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && git pull --ff-only"
fi

echo "[7/12] Configurando .env..."
if [ ! -f "${APP_DIR}/.env" ]; then
  sudo -u "${APP_USER}" cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
fi

cat > "${APP_DIR}/.env" <<ENVEOF
NODE_ENV=production
PORT=${APP_PORT}
APP_BASE_URL=${APP_BASE_URL}
DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}
DATABASE_SSL=false
ADMIN_USER=${ADMIN_USER}
ADMIN_PASS=${ADMIN_PASS}
ADMIN_SESSION_SECRET=${ADMIN_SESSION_SECRET}
API_KEY_PEPPER=${API_KEY_PEPPER}
ENVEOF

chown "${APP_USER}:${APP_GROUP}" "${APP_DIR}/.env"
chmod 640 "${APP_DIR}/.env"

echo "[8/12] Instalando dependencias npm..."
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && npm install"

echo "[9/12] Rodando migrate + seed..."
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && npm run db:migrate"
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && npm run db:seed"

echo "[10/12] Configurando PM2 (producao)..."
npm install -g pm2
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && pm2 start ecosystem.config.js --env production"
sudo -u "${APP_USER}" pm2 save
pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" || true

if [ "${USE_APACHE_PROXY}" = "true" ]; then
  echo "[11/12] Configurando Apache como proxy reverso..."
  apt install -y apache2
  a2enmod proxy proxy_http proxy_wstunnel headers rewrite ssl
  cat > /etc/apache2/sites-available/formulario.conf <<APACHECONF
<VirtualHost *:80>
  ServerName ${APP_DOMAIN}
  ProxyPreserveHost On
  ProxyPass / http://127.0.0.1:${APP_PORT}/
  ProxyPassReverse / http://127.0.0.1:${APP_PORT}/
  RequestHeader set X-Forwarded-Proto "http"
</VirtualHost>
APACHECONF
  a2ensite formulario.conf
  apache2ctl configtest
  systemctl reload apache2
fi

if [ "${USE_NGINX_PROXY}" = "true" ]; then
  echo "[11/12] Configurando Nginx como proxy reverso..."
  apt install -y nginx
  cat > /etc/nginx/sites-available/formulario <<NGINXCONF
server {
  listen 80;
  server_name ${APP_DOMAIN};

  location / {
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINXCONF
  ln -sf /etc/nginx/sites-available/formulario /etc/nginx/sites-enabled/formulario
  nginx -t
  systemctl reload nginx
fi

echo "[12/12] Validacao final..."
curl -I "http://127.0.0.1:${APP_PORT}" || true
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && pm2 status"

echo
echo "Instalacao finalizada."
echo "Revise variaveis no topo do script para ambiente real."
