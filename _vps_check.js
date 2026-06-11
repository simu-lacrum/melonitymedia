const { Client } = require('ssh2');
const conn = new Client();
const cmds = 'docker compose -f /opt/melonitymedia/docker-compose.yml logs worker --tail=100 --no-color 2>&1 | grep -E "login|Login|❌|✅|failed|error|Error|INVALID|CAPTCHA|NETWORK|2fa|banned" | tail -40';
conn.on('ready', () => {
  conn.exec(cmds, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    stream.on('close', () => conn.end());
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
}).on('error', e => { console.error('SSH error:', e.message); process.exit(1); })
  .connect({ host: '31.76.0.144', port: 22, username: 'root', password: 'kuSdcNO2eHvO', readyTimeout: 15000 });
