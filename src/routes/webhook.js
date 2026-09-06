const express = require('express');
const router = express.Router();
const dbService = require('../db/database');
const metaService = require('../services/metaService');
// Nour's conversational AI agent is disabled: this system is now a send-only
// WhatsApp OTP service for the Sanad Taxi app. Incoming messages are logged
// only, no auto-reply is generated. (See src/ai-engine/agentBrain.js and
// src/core/agent/agentLoop.js if this ever needs to be reactivated.)

const AHMAD_PHONE = '962782932611';

module.exports = (io) => {
  // Webhook Verification (Handshake with Meta)
  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = metaService.getConfig().verifyToken;

    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        console.log('✅ [Webhook Verified] Meta webhook successfully validated!');
        return res.status(200).send(challenge);
      } else {
        console.warn('❌ [Webhook Verify Failed] Token mismatch:', token, 'expected:', verifyToken);
        return res.sendStatus(403);
      }
    }
    return res.status(400).send('Missing hub parameters');
  });

  // Webhook Event Receiver (Incoming Messages & Statuses)
  router.post('/', async (req, res) => {
    console.log('🔔 [WEBHOOK_POST_HIT] Received from Meta:', JSON.stringify(req.body, null, 2));

    // Immediately return 200 OK to Meta
    res.sendStatus(200);

    const body = req.body;
    if (!body || body.object !== 'whatsapp_business_account') {
      return;
    }

    try {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0]?.value;

      if (!change) return;

      // Handle delivery receipts
      if (change.statuses && change.statuses.length > 0) {
        const statusUpdate = change.statuses[0];
        io.emit('message_status', {
          messageId: statusUpdate.id,
          status: statusUpdate.status,
          recipientId: statusUpdate.recipient_id
        });
        return;
      }

      // Handle incoming messages
      const messages = change.messages;
      if (!messages || messages.length === 0) return;

      const messageObj = messages[0];
      const fromPhone = messageObj.from.replace(/\D/g, '');
      const messageId = messageObj.id;

      const contactInfo = change.contacts?.[0];
      const senderName = contactInfo?.profile?.name || '';

      let text = '';
      let messageType = messageObj.type;

      if (messageType === 'text') {
        text = messageObj.text?.body || '';
      } else if (messageType === 'button') {
        text = messageObj.button?.text || '';
      } else if (messageType === 'interactive') {
        text = messageObj.interactive?.button_reply?.title || messageObj.interactive?.list_reply?.title || 'تفاعل مع قائمة';
      } else {
        text = `[رسالة من نوع ${messageType}]`;
      }

      console.log(`📩 [WhatsApp Incoming] From: ${fromPhone} (${senderName}): "${text}"`);

      // 1. Save incoming message in database
      const contact = dbService.upsertContact(fromPhone, senderName, text);
      const savedMessage = dbService.saveMessage({
        messageId,
        phone: fromPhone,
        direction: 'incoming',
        text,
        type: messageType,
        status: 'received'
      });

      // Emit to dashboard
      io.emit('new_message', {
        contact: dbService.getContact(fromPhone),
        message: savedMessage
      });

      // Mark as read on Meta
      metaService.markAsRead(messageId).catch(() => {});

      // Nour's AI agent no longer processes or replies to incoming messages.
      // This service only sends outbound OTP codes (see src/routes/otpRoutes.js);
      // incoming messages are simply logged above for the dashboard to display.

    } catch (err) {
      console.error('[Webhook Processing Error]:', err);
    }
  });

  return router;
};
