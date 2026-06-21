CREATE TYPE "ProxyProtocol" AS ENUM ('HTTP', 'SOCKS5');

ALTER TABLE "Proxy"
  ADD COLUMN "protocol" "ProxyProtocol" NOT NULL DEFAULT 'HTTP';

CREATE INDEX "Proxy_userId_protocol_host_port_idx"
  ON "Proxy"("userId", "protocol", "host", "port");
