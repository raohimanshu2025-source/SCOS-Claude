# City OS data exchange reference implementation. No npm dependencies: Node.js built-ins and OpenSSL only.
# The full bookworm image already has the openssl command line tool the certificate authority uses.
FROM node:22-bookworm
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY docs/requirements.json ./docs/requirements.json
ENV DX_DATA_DIR=/var/lib/cityos-dx/data DX_PKI_DIR=/var/lib/cityos-dx/pki DX_BACKUP_DIR=/var/lib/cityos-dx/backups DX_PORT=8443 NODE_ENV=production
RUN mkdir -p /var/lib/cityos-dx && chown node:node /var/lib/cityos-dx
USER node
VOLUME ["/var/lib/cityos-dx"]
EXPOSE 8443
HEALTHCHECK --interval=30s --timeout=10s CMD DX_CA_FILE=/var/lib/cityos-dx/pki/root/root.crt node scripts/uptime-check.js >/dev/null 2>&1 || exit 1
# First start creates the PKI and seeds the demo city; later starts reuse the volume.
CMD ["sh", "-c", "node scripts/init-pki.js && ( [ -f \"$DX_DATA_DIR/dx.sqlite\" ] || node --no-warnings src/seed.js ) && exec node --no-warnings src/server.js"]
