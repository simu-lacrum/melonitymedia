const { Client } = require('ssh2');
const conn = new Client();
const cmds = [
  'docker compose -f /opt/melonitymedia/docker-compose.yml ps',
  'echo "---WORKER LOGS---"',
  'docker compose -f /opt/melonitymedia/docker-compose.yml logs worker --tail=80 --no-color 2>&1',
  'echo "---API LOGS---"',
  'docker compose -f /opt/melonitymedia/docker-compose.yml logs api --tail=30 --no-color 2>&1',
].join(' && ');

conn.on('ready', () => {
  conn.exec(cmds, (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    stream.on('close', () => conn.end());
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
  });
}).connect({ host: '31.76.0.144', port: 22, username: 'root', password: 'kuSdcNO2eHvO' });
