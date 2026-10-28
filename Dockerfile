FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY frontend ./frontend
RUN npm run build
USER node
EXPOSE 3000
CMD ["npm", "start"]
