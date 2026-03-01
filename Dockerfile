FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ dist/
COPY glama.json ./

ENTRYPOINT ["node", "dist/index.js"]
