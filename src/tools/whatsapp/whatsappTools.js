
const metaService = require('../../services/metaService');
const dbService = require('../../db/database');
const auditService = require('../../security/audit');

module.exports = {
  async send({ toPhone, messageText, reason = 'Direct agent message', actorPhone = '962782932611' }) {
    const cleanPhone = String(toPhone).replace(/\D/g, '');
    const sendRes = await metaService.sendTextMessage(cleanPhone, messageText);
    const saved = dbService.saveMessage({
      messageId: sendRes?.messageId || 'out_tool_' + Date.now(),
      phone: cleanPhone,
      direction: 'outgoing',
      text: messageText,
      type: 'text',
      status: 'sent'
    });

    auditService.log({
      actorPhone,
      actorName: 'Nour AI',
      actionType: 'WHATSAPP_SEND',
      toolName: 'whatsapp.send',
      toolInput: { toPhone: cleanPhone, messageText },
      toolOutput: { messageId: saved?.message_id, status: 'sent' },
      riskLevel: 'MEDIUM',
      whyReason: reason
    });

    return {
      success: true,
      messageId: saved?.message_id,
      toPhone: cleanPhone,
      text: messageText
    };
  }
};
