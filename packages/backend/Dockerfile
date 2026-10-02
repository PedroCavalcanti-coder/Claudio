# ─────────────────────────────────────────────────────────────────────────────
# RIS/PACS Backend — Node.js 22 + Express + Chromium (pra render de laudo PDF)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Puppeteer baixa Chromium completo no postinstall (~250MB). Como vamos usar
# o Chromium do sistema via PUPPETEER_EXECUTABLE_PATH, pulamos esse download
# pra deixar a imagem menor.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev


# ─── Runtime ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Chromium do Alpine + libs necessárias pra renderizar PDFs
# (~140MB extra na imagem — aceitável pro PDF de laudo CFM-compliant)
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-noto-emoji

# Usuário não-root pra segurança
# uid FIXO (10001): o volume de worklists é compartilhado com o Orthanc e recebe chown para este uid.
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=deps   /app/node_modules ./node_modules
COPY --chown=app:app src         ./src
COPY --chown=app:app migrations  ./migrations
COPY --chown=app:app scripts     ./scripts
COPY --chown=app:app package.json ./

# Cria diretório de logs writable pelo usuário não-root
RUN mkdir -p /app/logs /var/lib/orthanc/worklists && chown -R app:app /app/logs /var/lib/orthanc/worklists

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/app.js"]
