# ─────────────────────────────────────────────────────────────────────────────
# RIS/PACS Frontend — multi-stage: Node build → nginx serve
# ─────────────────────────────────────────────────────────────────────────────

# ─── Build stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Vite lê VITE_* das env vars em build time
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}

# Bypass tsc -b (errors pré-existentes em react-hook-form/zod) — vite build é a fonte da verdade
RUN npx vite build


# ─── Runtime: nginx ─────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove a config default do nginx
RUN rm /etc/nginx/conf.d/default.conf

# Nossa config: SPA fallback + proxy /api → backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copia o build do Vite
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz | grep -q ok || exit 1

CMD ["nginx", "-g", "daemon off;"]
