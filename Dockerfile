# ใช้ Node.js version 20 จาก Alpine Linux (Base Image ขนาดเล็ก)
FROM node:20-alpine

# กำหนด Working Directory ภายใน Container
WORKDIR /app

# Copy package.json และ package-lock.json (หรือ yarn.lock) ไปยัง Working Directory
# เพื่อให้ Docker Cache Layer นี้ และไม่ต้องติดตั้ง dependencies ใหม่ทุกครั้งที่เปลี่ยนโค้ด
COPY package*.json ./

# ติดตั้ง Node Dependencies
RUN npm install --production

# Copy โค้ดทั้งหมดของโปรเจกต์ไปยัง Working Directory
COPY . .

# เปิด Port ที่แอปพลิเคชันจะรันอยู่ (ต้องตรงกับ PORT ใน .env หรือ app.js)
EXPOSE 3000

# คำสั่งเริ่มต้นเมื่อ Container ถูกรัน
CMD ["node", "src/app.js"]