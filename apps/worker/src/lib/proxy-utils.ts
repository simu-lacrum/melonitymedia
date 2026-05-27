export function buildProxyUrl(p: {
  host: string;
  port?: number | null;
  username?: string | null;
  password?: string | null;
}): string {
  let hostStr = p.host.trim();
  
  let protocol = 'http://';
  if (hostStr.startsWith('http://')) { protocol = 'http://'; hostStr = hostStr.slice(7); }
  else if (hostStr.startsWith('https://')) { protocol = 'https://'; hostStr = hostStr.slice(8); }
  else if (hostStr.startsWith('socks5://')) { protocol = 'socks5://'; hostStr = hostStr.slice(9); }

  let user = p.username || '';
  let pass = p.password || '';
  let ip = hostStr;
  let port = p.port ? String(p.port) : '';

  // 1. user:pass@ip:port
  if (hostStr.includes('@')) {
    const atParts = hostStr.split('@');
    const authParts = atParts[0].split(':');
    user = decodeURIComponent(authParts[0]) || user;
    pass = decodeURIComponent(authParts.slice(1).join(':')) || pass;
    ip = atParts.slice(1).join('@');
  } 
  // 2. ip:port:user:pass (legacy)
  else if (hostStr.split(':').length === 4 && !hostStr.includes(']')) {
    const colonParts = hostStr.split(':');
    ip = colonParts[0];
    port = colonParts[1];
    user = colonParts[2];
    pass = colonParts[3];
  }

  // 3. Extract port from ip if present (and not an IPv6 address)
  if (ip.includes(':') && !ip.includes(']')) {
    const ipParts = ip.split(':');
    ip = ipParts[0];
    port = ipParts[1] || port;
  }

  try {
    const auth = (user && pass) ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
    const portStr = port ? `:${port}` : '';
    const u = new URL(`${protocol}${auth}${ip}${portStr}`);
    return u.toString().replace(/\/$/, '');
  } catch {
    return `${protocol}${ip}`;
  }
}
