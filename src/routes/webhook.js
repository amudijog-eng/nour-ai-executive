const express = require('express');
const router = express.Router();
const dbService = require('../db/database');
const metaService = require('../services/metaService');
const agentBrain = require('../ai-engine/agentBrain');

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

      // 2. Dispatch message to the Autonomous Agent Brain
      const isAhmad = (fromPhone === AHMAD_PHONE.replace(/\D/g, ''));
      console.log(`🧠 [Agent Brain Engine] Processing incoming message from ${fromPhone} (isAhmad: ${isAhmad})...`);

      const agentResult = await agentBrain.processIncomingMessage({
        fromPhone,
        senderName,
        text,
        isAdmin: isAhmad
      });

      if (!agentResult) return;

      // Helper function to send and persist outgoing message
      const sendAndSave = async (toPhone, msgText, emitEvent = null, extraPayload = {}) => {
        if (!toPhone || !msgText) return null;
        console.log(`📤 [Sending WhatsApp] To ${toPhone}: "${msgText.slice(0, 50)}..."`);
        try {
          const sendRes = await metaService.sendTextMessage(toPhone, msgText);
          const saved = dbService.saveMessage({
            messageId: sendRes?.messageId || 'out_' + Date.now(),
            phone: toPhone,
            direction: 'outgoing',
            text: msgText,
            type: 'text',
            status: 'sent'
          });
          io.emit('new_message', {
            contact: dbService.getContact(toPhone),
            message: saved
          });
          if (emitEvent) {
            io.emit(emitEvent, extraPayload);
          }
          return saved;
        } catch (err) {
          console.error(`❌ [Failed to send WhatsApp] To ${toPhone}:`, err.message);
          return null;
        }
      };

      // Case A: Ahmad Initiated an Outbound Task (e.g. Asking Khaled Salameh for dinner)
      if (agentResult.action === 'ADMIN_TASK_INITIATED') {
        // 1. Dispatch message to the target contact (Khaled)
        await sendAndSave(agentResult.targetPhone, agentResult.messageToTarget, 'task_created', { task: agentResult.task });
        // 2. Confirm to Ahmad
        await sendAndSave(fromPhone || AHMAD_PHONE, agentResult.replyToAhmad);
        return;
      }

      // Case B: Ahmad forwarded a reply to a support ticket
      if (agentResult.action === 'ADMIN_FORWARD_REPLY') {
        await sendAndSave(agentResult.targetCustomerPhone, agentResult.messageToCustomer);
        await sendAndSave(fromPhone || AHMAD_PHONE, agentResult.replyToAhmad, 'ticket_updated', { ticketNumber: agentResult.ticketNumber });
        return;
      }

      // Case C: Any other interaction from Ahmad (Direct reply, chat, task feedback, CRM)
      if (isAhmad || agentResult.replyToAhmad) {
        if (agentResult.replyToAhmad) {
          await sendAndSave(fromPhone || AHMAD_PHONE, agentResult.replyToAhmad);
        }
        return;
      }

      // Case D: Target contact replied to an active task (e.g. Khaled Salameh responded)
      if (agentResult.action === 'TASK_REPLY_HANDLED') {
        // 1. Reply acknowledging to target
        await sendAndSave(fromPhone, agentResult.replyToCustomer);
        // 2. Send instant alert card to Ahmad
        await sendAndSave(AHMAD_PHONE, agentResult.adminNotification, 'task_updated', { task: agentResult.task });
        return;
      }

      // Case E: Customer normal dialogue
      if (agentResult.replyToCustomer) {
        await sendAndSave(fromPhone, agentResult.replyToCustomer);
      }

      // Case F: Security alert or ticket dispatch to Ahmad
      if (agentResult.adminNotification) {
        console.log(`🔔 [Dispatching Notification to Ahmad (+962782932611)]`);
        await sendAndSave(AHMAD_PHONE, agentResult.adminNotification, agentResult.ticket ? 'ticket_created' : 'admin_alert', { ticket: agentResult.ticket });
      }

    } catch (err) {
      console.error('[Webhook Processing Error]:', err);
    }
  });

  return router;
};
