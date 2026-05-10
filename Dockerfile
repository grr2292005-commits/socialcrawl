FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# The command is overridden by docker-compose.yml for api and worker
CMD ["npm", "run", "dev:api"]
