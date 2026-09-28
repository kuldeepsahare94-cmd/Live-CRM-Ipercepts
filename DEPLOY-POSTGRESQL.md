# iCRM on PostgreSQL: deploy guide

This CRM runs **100% on PostgreSQL**. There is no SQLite database, no SQLite package and no `crm.db` file.
It starts with a fresh, empty database: on first start it creates all tables and the first login `admin` / `admin123`.
Uploaded files (documents, attachments) live in a folder on disk (`DATA_DIR`).

- Part A: test on Render (backend) + Vercel (frontend)
- Part B: move to a Hostinger VPS with many customers
- Part C: backups
- Part D: checks and notes

---

## Part A: Render + Vercel (testing)

### Option 1: Blueprint (easiest)
1. Push this project to GitHub.
2. In Render, go to **New → Blueprint** and pick the repo. Render reads `render.yaml` and creates:
   - a PostgreSQL database `icrm-db`
   - the backend web service, with `DATABASE_URL` filled in automatically and a disk at `/var/data` for uploaded files.
3. When Render asks, fill in `FRONTEND_URL` (your Vercel URL) and `ANTHROPIC_API_KEY` (optional).
4. Deploy. The log should show the server starting with no errors.

### Option 2: you already have the backend service on Render
Keep your current web service and its disk (for uploaded files). Then:
1. In Render, go to **New → PostgreSQL**. Use the **same region** as the web service. The free plan is fine for testing; it expires after 30 days.
2. Open the new database and copy the **Internal Database URL**.
3. Open your web service, go to **Environment** and add:
   - `DATABASE_URL` = the internal URL you copied
   - keep `DATA_DIR=/var/data` (or whatever your disk path is)
4. Push this code. Render runs `npm install` itself, which installs the `pg` package.
5. The first start creates all tables. Log in with `admin` / `admin123` and change the password.

If an old `crm.db` file is still on the disk, it is simply ignored. You can delete it.

### Vercel (frontend)
No change. Keep `VITE_API_BASE_URL` = your Render backend URL.

### Important Render notes
- Use the **Internal** database URL (no SSL needed). If you use the External URL, also set `DATABASE_SSL=true`.
- The free web service sleeps after 15 minutes. The first request after that takes 30 to 60 seconds. This is a Render limit, not a CRM problem.

---

## Part B: Hostinger VPS, about 50 customers

Design: **one copy of the code** serves everyone. Each customer gets:
- their own PostgreSQL database
- their own backend process (PM2) on its own port
- their own upload folder and secrets
- their own domain (nginx)

One code update (`git pull`) updates all customers.

### 1. Server setup (once)
Ubuntu 22.04/24.04, KVM 4 or bigger (16 GB RAM is comfortable for 50 customers).
```bash
sudo apt update && sudo apt install -y postgresql nginx certbot python3-certbot-nginx git build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm install -g pm2
```

### 2. Code (once)
```bash
sudo mkdir -p /srv/icrm && cd /srv/icrm
sudo git clone https://github.com/<you>/<repo>.git app
cd app/backend && sudo npm ci --omit=dev
cd ../frontend && sudo npm ci && sudo npm run build     # do NOT set VITE_API_BASE_URL here
```
Leave `VITE_API_BASE_URL` empty on Hostinger. Each customer's domain then calls its own `/api`, and one frontend build serves every customer.

### 3. Add a customer (repeat per customer)
First point the customer's domain (A record) to the VPS IP. Then run:
```bash
cd /srv/icrm/app/deploy/hostinger
sudo ./new-customer.sh acme crm.acme.com 4101
pm2 start ecosystem.config.js --only crm-acme && pm2 save
sudo certbot --nginx -d crm.acme.com
```
Use a new port for each customer (4101, 4102, 4103 ...).
The script creates the database and its password, the upload folder, a `.env` with random secrets, and the nginx site.
First login is `admin` / `admin123`. Change it right away.

### 4. Start on reboot and nightly backups (once)
```bash
pm2 startup        # run the command it prints
pm2 save
sudo crontab -e    # add this line:
30 2 * * * /srv/icrm/app/deploy/hostinger/backup-all.sh
```
Backups go to `/srv/icrm/backups/<date>/` and are kept for 14 days. The restore command is written at the bottom of `backup-all.sh`.
Also back up `/srv/icrm/customers/` (uploaded files and `.env` files).

### 5. Updating all customers
```bash
cd /srv/icrm/app && sudo git pull
cd backend && sudo npm ci --omit=dev
cd ../frontend && sudo npm ci && sudo npm run build
pm2 reload all
```

### Sizing
- Each customer process uses about 140 MB of RAM when idle, so 50 customers need about 7 GB, plus PostgreSQL.
- `ecosystem.config.js` restarts a process that goes above 400 MB.
- PostgreSQL defaults allow 100 connections, and each customer uses 1, so 50 customers is fine. For more than about 90 customers, raise `max_connections` in `postgresql.conf`.

---

## Part C: backups

- **From the screen:** Settings → Data → **Download Backup** gives one `.json` file with all records. **Email Backup Now** sends it as `.json.gz`.
- **Restore:** Settings → Data → **Restore from Backup** → choose a `.json` or `.json.gz` backup. All data is replaced in one step. If anything fails, nothing changes.
- **Hostinger:** the nightly `backup-all.sh` job (Part B, step 4) makes a PostgreSQL dump of every customer.
- **Render:** paid PostgreSQL plans include daily backups in the Render dashboard.

Uploaded files are not part of the database backup. Back up `DATA_DIR` separately.

---

## Part D: checks and notes

### Quick check after deploy
- `https://<backend>/api/health` should return `ok`.
- Log in, open the dashboard, and click a few drill-downs.
- Add a lead, edit it, and search for it.
- Settings → Data → **Download Backup** should give a `.json` file.

### Notes
- A **blank number field** is saved as empty (NULL).
- Each server process holds one PostgreSQL connection and runs one query at a time. For one customer per process (the Hostinger setup) this is plenty. An average page request takes about 7 ms of database time.
- Backups are `.json` files (see Part C).

### Settings reference (backend `.env`)
| Name | Needed | What it is |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/dbname` |
| `DATABASE_SSL` | no | `true` only for internet connections (Render External URL) |
| `DATA_DIR` | yes in production | Folder for uploaded files (a persistent disk) |
| `JWT_SECRET` | yes | Long random text |
| `CRM_ENCRYPTION_KEY` | recommended | 32 random bytes, base64 |
| `FRONTEND_URL` | yes | Frontend address (for links and CORS) |
| `CRM_TIMEZONE` | no | Default `Asia/Kolkata` |

See `backend/.env.example` for a full example.
