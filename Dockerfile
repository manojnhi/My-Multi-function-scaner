FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* bun.lock* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY firebase-applet-config.json ./
COPY native-ecosystem ./native-ecosystem
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "dist-server/server.mjs"]
