/* PM2 config for many customers on one server.
 *
 * ONE copy of the code serves every customer. Each customer is a separate
 * PM2 process with its own database, port, upload folder and secrets,
 * read from /srv/icrm/customers/<name>/.env (created by new-customer.sh).
 *
 *   pm2 start deploy/hostinger/ecosystem.config.js     # start all
 *   pm2 reload all                                     # after git pull
 *   pm2 save && pm2 startup                            # start on boot
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ICRM_ROOT || '/srv/icrm';
const customers = JSON.parse(fs.readFileSync(path.join(ROOT, 'customers.json'), 'utf8'));

const readEnv = (file) => Object.fromEntries(
  fs.readFileSync(file, 'utf8').split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

module.exports = {
  apps: customers.map((c) => ({
    name: `crm-${c.name}`,
    cwd: path.join(ROOT, 'app', 'backend'),
    script: 'server.js',
    env: { NODE_ENV: 'production', ...readEnv(path.join(ROOT, 'customers', c.name, '.env')) },
    max_memory_restart: '400M',
    time: true,
  })),
};
