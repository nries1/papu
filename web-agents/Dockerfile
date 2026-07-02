FROM mcr.microsoft.com/playwright:v1.61.1-noble AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.61.1-noble
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
