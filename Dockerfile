# Stage 1: Build & Obfuscate
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build && npm run obfuscate

# Stage 2: Production Image (No Source Code inside)
FROM mcr.microsoft.com/playwright:v1.59.1-jammy
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
RUN npm install --omit=dev

CMD ["node", "dist/index.js"]
