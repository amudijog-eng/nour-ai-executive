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

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

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

app.use('/webhook', webhookRoutes);
app.use('/api', apiRoutes);

// Fallback for Single Page App
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start Server
server.listen(PORT, () => {
  console.log(`
=====================================================
🚀 سيرفر واتساب والسكرتيرة الذكية يعمل بنجاح!
-----------------------------------------------------
🌐 واجهة التحكم (Dashboard): http://localhost:${PORT}
🔗 نقطة الـ Webhook لميتا:   http://localhost:${PORT}/webhook
⚙️  نظام قاعدة البيانات:      SQLite (محلي مدمج)
🤖 وضع السكرتيرة الذكية:     مفعّل
=====================================================
  `);
});
