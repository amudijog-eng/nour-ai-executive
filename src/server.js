require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Old Nour dashboard (conversation history, CRM, tickets) is moved off the
// public root so external partners hitting the base URL never see it. Only
// someone who knows the /dashboard path can reach it.
app.use('/dashboard', express.static(path.join(__dirname, '..', 'public')));

// Socket.io Connection
io.on('connection', (socket) => {
  console.log(`🔌 [Socket.io] عميل جديد متصل بالداشبورد: ${socket.id}`);
  socket.on('disconnect', () => {
    // Client disconnected
  });
});

// Mount Routes
const webhookRoutes = require('./routes/webhook')(io);
const apiRoutes = require('./routes/api')(io);
const otpRoutes = require('./routes/otpRoutes');

app.use('/webhook', webhookRoutes);
app.use('/api', apiRoutes);
app.use('/api/otp', otpRoutes);

// Neutral public root — no dashboard/conversation data exposed here
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Sanad Taxi OTP API' });
});

// Fallback for the dashboard SPA only
app.get('/dashboard/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start Server
server.listen(PORT, () => {
  console.log(`
=====================================================
🚀 سيرفر Sanad Taxi OTP عبر واتساب يعمل بنجاح!
-----------------------------------------------------
🌐 واجهة التحكم (Dashboard):   http://localhost:${PORT}/dashboard
📲 نقطة إرسال رمز التحقق:      POST http://localhost:${PORT}/api/otp/send
🔗 نقطة الـ Webhook لميتا:      http://localhost:${PORT}/webhook
⚙️  نظام قاعدة البيانات:        SQLite (محلي مدمج)
🤖 وضع السكرتيرة الذكية (نور):  معطّل (send-only OTP mode)
=====================================================
  `);
});
