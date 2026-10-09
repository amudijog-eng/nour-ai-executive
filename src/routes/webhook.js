const express = require('express');
const router = express.Router();
const dbService = require('../db/database');
const metaService = require('../services/metaService');
const cloudflareAi = require('../services/cloudflareAi');
const voiceService = require('../services/voiceService');

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

      // 2. Check if voice response was requested (audio message or text asking for voice)
      const wantsVoice = voiceService.isVoiceRequested(text, messageType);

      // 3. Generate Intelligent Reply via Cloudflare Workers AI
      console.log(`🤖 [Webhook] Processing message via Cloudflare Workers AI for ${fromPhone} (wantsVoice: ${wantsVoice})...`);
      const replyText = await cloudflareAi.generateReply({
        fromPhone,
        senderName,
        incomingText: text
      });

      if (replyText) {
        try {
          let sendRes = null;
          let outType = 'text';

          if (wantsVoice) {
            console.log(`🎙️ [Voice Synthesis] Converting reply to voice note for ${fromPhone}...`);
            try {
              const audioBuffer = await voiceService.textToVoice(replyText);
              sendRes = await metaService.sendVoiceMessage(fromPhone, audioBuffer);
              outType = 'audio';
              console.log(`✅ [Voice Sent] Voice note successfully delivered to ${fromPhone}!`);
            } catch (voiceErr) {
              console.warn(`⚠️ [Voice Synthesis Failed, falling back to text]:`, voiceErr.message);
              sendRes = await metaService.sendTextMessage(fromPhone, replyText);
            }
          } else {
            console.log(`📤 [Sending WhatsApp Reply] To ${fromPhone}: "${replyText.slice(0, 60)}..."`);
            sendRes = await metaService.sendTextMessage(fromPhone, replyText);
          }

          const savedReply = dbService.saveMessage({
            messageId: sendRes?.messageId || 'out_' + Date.now(),
            phone: fromPhone,
            direction: 'outgoing',
            text: replyText,
            type: outType,
            status: 'sent'
          });

          io.emit('new_message', {
            contact: dbService.getContact(fromPhone),
            message: savedReply
          });

          // If a third party sent a message, notify Ahmad immediately with the details!
          if (fromPhone !== AHMAD_PHONE) {
            console.log(`🔔 [Forwarding to Ahmad] New message from ${fromPhone}`);
            const alertMsg = `أستاذ أحمد، وصل رد من الرقم (+${fromPhone}):\n"${text}"\n\nنشمي رد عليه بـ:\n"${replyText}" 👍`;
            metaService.sendTextMessage(AHMAD_PHONE, alertMsg).catch((err) => {
              console.warn('Could not forward alert to Ahmad:', err.message);
            });
          }
        } catch (sendErr) {
          console.error(`❌ [Failed to send WhatsApp reply] To ${fromPhone}:`, sendErr.message);
        }
      }

    } catch (err) {
      console.error('[Webhook Processing Error]:', err);
    }
  });

  return router;
};
