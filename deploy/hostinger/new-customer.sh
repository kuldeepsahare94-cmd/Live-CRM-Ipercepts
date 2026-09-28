#!/bin/bash
# Add one customer: database + user, upload folder, settings, web address.
#   sudo ./new-customer.sh <name> <domain> <port>
#   e.g. sudo ./new-customer.sh acme acme.yourcrm.in 4101
# Then: pm2 start /srv/icrm/app/deploy/hostinger/ecosystem.config.js --only crm-<name>
set -euo pipefail
NAME="$1"; DOMAIN="$2"; PORT="$3"
ROOT=/srv/icrm
[[ "$NAME" =~ ^[a-z][a-z0-9_]{1,30}$ ]] || { echo "name: lowercase letters, digits, _ (e.g. acme)"; exit 1; }
DB="icrm_${NAME}"; USER="icrm_${NAME}"
PASS=$(openssl rand -hex 16)

# 1. PostgreSQL database and user
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE ${USER} LOGIN PASSWORD '${PASS}';
CREATE DATABASE ${DB} OWNER ${USER} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C.UTF-8';
SQL

# 2. Upload folder + settings
mkdir -p "${ROOT}/customers/${NAME}/data"
cat > "${ROOT}/customers/${NAME}/.env" <<ENV
DATABASE_URL=postgres://${USER}:${PASS}@127.0.0.1:5432/${DB}
DATA_DIR=${ROOT}/customers/${NAME}/data
PORT=${PORT}
JWT_SECRET=$(openssl rand -hex 32)
CRM_ENCRYPTION_KEY=$(openssl rand -base64 32)
FRONTEND_URL=https://${DOMAIN}
PUBLIC_BACKEND_URL=https://${DOMAIN}
PUBLIC_FRONTEND_URL=https://${DOMAIN}
CRM_TIMEZONE=Asia/Kolkata
ENV
chmod 600 "${ROOT}/customers/${NAME}/.env"

# 3. Add to customers.json (used by ecosystem.config.js)
[ -f "${ROOT}/customers.json" ] || echo '[]' > "${ROOT}/customers.json"
node -e "
const f='${ROOT}/customers.json'; const l=JSON.parse(require('fs').readFileSync(f,'utf8'));
if (l.some(c=>c.name==='${NAME}'||c.port===${PORT})) { console.error('name or port already used'); process.exit(1); }
l.push({name:'${NAME}',domain:'${DOMAIN}',port:${PORT}}); require('fs').writeFileSync(f, JSON.stringify(l,null,2));"

# 4. Web address (nginx): frontend files + /api to this customer's port
sed -e "s/__DOMAIN__/${DOMAIN}/g" -e "s/__PORT__/${PORT}/g" "${ROOT}/app/deploy/hostinger/nginx-site.conf" \
  > "/etc/nginx/sites-available/${DOMAIN}"
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload)

echo "Customer ${NAME} ready. Start it:  pm2 start ${ROOT}/app/deploy/hostinger/ecosystem.config.js --only crm-${NAME} && pm2 save"
echo "HTTPS:  certbot --nginx -d ${DOMAIN}"
echo "First login: admin / admin123 - change it immediately."
