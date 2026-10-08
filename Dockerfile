# 폴리게스 서버 컨테이너. Render/Fly/Railway 등 Docker 를 받는 곳 어디서나 그대로 돌아갑니다.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
