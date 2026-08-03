FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY lib.js server.js ./
EXPOSE 8081
USER node
CMD ["node", "server.js"]
