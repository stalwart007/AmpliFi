# Build from the repo root:
#   docker build -f services/pricing-api/Dockerfile -t amplifi-pricing-api .
FROM node:20-slim
WORKDIR /app

# Install the whole workspace (the service consumes @amplifi/* via the monorepo).
COPY . .
RUN npm ci || npm install

ENV NODE_ENV=production
ENV PORT=8801
EXPOSE 8801
USER node

# Liveness check hits the public /health route.
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8801)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "@amplifi/pricing-api"]
