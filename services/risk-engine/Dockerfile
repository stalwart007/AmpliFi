# Build from the repo root:
#   docker build -f services/risk-engine/Dockerfile -t amplifi-risk-engine .
FROM node:20-slim
WORKDIR /app

COPY . .
RUN npm ci || npm install

ENV NODE_ENV=production
ENV PORT=8802
EXPOSE 8802
USER node

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8802)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "@amplifi/risk-engine"]
