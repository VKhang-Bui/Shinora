FROM node:22-bookworm-slim

WORKDIR /app

# Sao chép package.json
COPY package*.json ./

# Cài đặt dependencies (nếu có)
RUN npm install --omit=dev

# Sao chép toàn bộ mã nguồn
COPY . .

# Đảm bảo thư mục lưu trữ database tồn tại
RUN mkdir -p /app/backend/database

# Cổng mặc định
EXPOSE 3000

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV PORT=3000
ENV NODE_ENV=production

# Khởi chạy máy chủ Node.js
CMD ["node", "backend/server.js"]
