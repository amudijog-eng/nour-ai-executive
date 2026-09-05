const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const dbService = require('../db/database');
const metaService = require('../services/metaService');
const aiSecretary = require('../services/aiSecretary');

module.exports = (io) => {
  // Get all contacts
  router.get('/contacts', (req, res) => {
    try {
      const contacts = dbService.getContacts();
      res.json(contacts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get messages for a contact
  router.get('/messages/:phone', (req, res) => {
    try {
      const { phone } = req.params;
      const messages = dbService.getMessages(phone);
      dbService.markContactRead(phone);
      res.json(messages);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send manual message from Dashboard
  router.post('/send', async (req, res) => {
    try {
      const { phone, text } = req.body;
      if (!phone || !text) {
        return res.status(400).json({ error: 'Phone and text are required' });
      }

      // Send to Meta
      const result = await metaService.sendTextMessage(phone, text);

      // Save to database
      const savedMessage = dbService.saveMessage({
        messageId: result.messageId || 'local_' + Date.now(),
        phone,
        direction: 'outgoing',
        text,
        type: 'text',
        status: 'sent'
      });

      // Broadcast to all dashboard clients
      io.emit('new_message', {
        contact: dbService.getContact(phone),
        message: savedMessage
      });

      res.json({ success: true, message: savedMessage });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upload & Send Media (Photos, Documents)
  router.post('/upload-media', async (req, res) => {
    try {
      const { phone, filename, base64Data, caption, mediaType } = req.body;
      if (!phone || !base64Data || !filename) {
        return res.status(400).json({ error: 'Missing required media fields' });
      }

      const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const filePath = path.join(uploadsDir, safeName);

      // Clean base64 header if present
      const cleanBase64 = base64Data.replace(/^data:([A-Za-z-+\/]+);base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));

      const fileUrl = `/uploads/${safeName}`;
      const msgText = caption ? `${caption}\n${fileUrl}` : fileUrl;
      const type = mediaType || (filename.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? 'image' : 'document');

      // Save outgoing message
      const savedMessage = dbService.saveMessage({
        messageId: 'media_' + Date.now(),
        phone,
        direction: 'outgoing',
        text: msgText,
        type,
        status: 'sent'
      });

      // Attempt to send via Meta text link or media
      try {
        await metaService.sendTextMessage(phone, `📎 [مرفق: ${filename}]\n${caption || ''}`);
      } catch (metaErr) {
        console.warn('Meta media note:', metaErr.message);
      }

      io.emit('new_message', {
        contact: dbService.getContact(phone),
        message: savedMessage
      });

      res.json({ success: true, fileUrl, message: savedMessage });
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Toggle AI for a contact
  router.post('/contacts/:phone/toggle-ai', (req, res) => {
    try {
      const { phone } = req.params;
      const { enabled } = req.body;
      const updated = dbService.updateContactAi(phone, enabled);
      io.emit('contact_updated', updated);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get notes and appointments
  router.get('/notes', (req, res) => {
    try {
      const phone = req.query.phone || null;
      const notes = dbService.getNotes(phone);
      res.json(notes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add note manually
  router.post('/notes', (req, res) => {
    try {
      const { phone, title, content, type } = req.body;
      const note = dbService.addNote(phone, title, content, type || 'note');
      io.emit('notes_updated', { notes: dbService.getNotes() });
      res.json(note);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get settings
  router.get('/settings', (req, res) => {
    try {
      const settings = dbService.getAllSettings();
      // Mask secret tokens for safety
      const safeSettings = { ...settings };
      if (safeSettings.meta_access_token) {
        safeSettings.meta_access_token_masked = safeSettings.meta_access_token.slice(0, 8) + '...' + safeSettings.meta_access_token.slice(-6);
      }
      if (safeSettings.ai_api_key) {
        safeSettings.ai_api_key_masked = safeSettings.ai_api_key.slice(0, 6) + '...' + safeSettings.ai_api_key.slice(-4);
      }
      res.json(safeSettings);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update settings
  router.post('/settings', (req, res) => {
    try {
      const updates = req.body;
      for (const [key, val] of Object.entries(updates)) {
        if (val !== undefined && val !== null) {
          dbService.setSetting(key, val);
        }
      }
      res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Support Tickets API
  router.get('/tickets', (req, res) => {
    try {
      const tickets = dbService.getTickets();
      res.json(tickets);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/tickets/:ticketNumber/reply', async (req, res) => {
    try {
      const { ticketNumber } = req.params;
      const { replyText } = req.body;
      const ticket = dbService.getTicketByNumber(ticketNumber);
      if (!ticket) {
        return res.status(404).json({ error: 'التذكرة غير موجودة' });
      }

      dbService.updateTicketAdminReply(ticketNumber, replyText);

      const customerMsg = `مرحباً بك أستاذ ${ticket.customer_name || ''} 🌸\n\nبخصوص تذكرتك رقم *[#${ticket.ticket_number}]*:\n\n💬 *رد الأستاذ أحمد العامودي:*\n"${replyText}"\n\nإذا كان لديك أي استفسار إضافي يسعدنا خدمتك!`;

      // Send to customer via Meta
      await metaService.sendTextMessage(ticket.customer_phone, customerMsg);

      dbService.saveMessage({
        messageId: 'dash_' + Date.now(),
        phone: ticket.customer_phone,
        direction: 'outgoing',
        text: customerMsg,
        type: 'text',
        status: 'sent'
      });

      io.emit('ticket_updated', { ticketNumber });
      res.json({ success: true, message: 'تم إرسال الرد للعميل وتحديث التذكرة' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Check Meta connection status
  router.get('/status', async (req, res) => {
    try {
      const status = await metaService.checkStatus();
      res.json(status);
    } catch (err) {
      res.json({ configured: false, status: 'error', message: err.message });
    }
  });

  // Simulate incoming message (for local testing & debugging without Meta)
  router.post('/simulate', async (req, res) => {
    try {
      const { phone = '962791234567', name = 'أحمد خليل', text = 'مرحباً، بدي أحجز موعد بكرة الساعة 3' } = req.body;
      
      const contact = dbService.upsertContact(phone, name, text);
      const savedMessage = dbService.saveMessage({
        messageId: 'sim_' + Date.now(),
        phone,
        direction: 'incoming',
        text,
        type: 'text',
        status: 'received'
      });

      io.emit('new_message', {
        contact: dbService.getContact(phone),
        message: savedMessage
      });

      // Trigger AI if enabled
      let aiResponse = null;
      if (aiSecretary.isAiEnabledForContact(phone)) {
        const reply = await aiSecretary.generateReply(phone, text, name);
        if (reply) {
          const aiMsg = dbService.saveMessage({
            messageId: 'sim_ai_' + Date.now(),
            phone,
            direction: 'outgoing',
            text: reply,
            type: 'text',
            status: 'sent'
          });
          aiResponse = aiMsg;

          setTimeout(() => {
            io.emit('new_message', {
              contact: dbService.getContact(phone),
              message: aiMsg
            });
            io.emit('notes_updated', {
              notes: dbService.getNotes()
            });
          }, 800);
        }
      }

      res.json({ success: true, contact, message: savedMessage, aiResponse });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  
  // -------------------------------------------------------------
  // CRM & Agent Tasks Endpoints (n8n Autonomous Engine)
  // -------------------------------------------------------------

  // List all CRM contacts
  router.get('/crm', (req, res) => {
    try {
      const contacts = dbService.getCrmContacts();
      res.json(contacts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Save/Update CRM contact
  router.post('/crm', (req, res) => {
    try {
      const { phone, full_name, nickname, relation, company, notes, tags } = req.body;
      if (!phone || !full_name) {
        return res.status(400).json({ error: 'Phone and full_name are required' });
      }
      const contact = dbService.upsertCrmContact({ phone, full_name, nickname, relation, company, notes, tags });
      io.emit('crm_updated', { contact });
      res.json({ success: true, contact });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete CRM contact
  router.delete('/crm/:id', (req, res) => {
    try {
      dbService.deleteCrmContact(req.params.id);
      io.emit('crm_updated');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // List all Agent Tasks
  router.get('/tasks', (req, res) => {
    try {
      const status = req.query.status || null;
      const tasks = dbService.getAgentTasks(status);
      res.json(tasks);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
