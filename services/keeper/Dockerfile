# Build from the repo root:
#   docker build -f services/keeper/Dockerfile -t amplifi-keeper .
# The keeper is an off-chain agent (no HTTP port). It currently drives the
# in-memory engine; a live chain client is wired via env once contracts deploy.
FROM node:20-slim
WORKDIR /app

COPY . .
RUN npm ci || npm install

ENV NODE_ENV=production
USER node

CMD ["npm", "run", "start", "-w", "@amplifi/keeper"]
