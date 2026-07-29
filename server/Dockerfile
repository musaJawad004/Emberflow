# Emberflow server — Fastify API + BullMQ worker + pipeline runner.
#
# Includes the docker CLI (stages run against the daemon reachable at
# /var/run/docker.sock — mounted by docker-compose.yml) and git (clone
# for gitUrl/webhook triggers).

FROM node:20-alpine

RUN apk add --no-cache docker-cli git

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src

ENV EMBER_PORT=4100
EXPOSE 4100

CMD ["npm", "start"]
