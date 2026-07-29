# Emberflow dashboard — Next.js production build, served on :3100.

# ---- build stage -----------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime stage ---------------------------------------------------------
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./

EXPOSE 3100

CMD ["npx", "next", "start", "-p", "3100"]
