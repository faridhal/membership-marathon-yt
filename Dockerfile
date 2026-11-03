FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .

# config.json dan data/ disimpan di volume /data supaya tidak hilang saat container dibuat ulang.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 APP_DIR=/data
VOLUME /data
EXPOSE 3000

CMD ["node", "server.js"]
