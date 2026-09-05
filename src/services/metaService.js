const axios = require('axios');
const dbService = require('../db/database');

const META_API_VERSION = 'v21.0';

class MetaService {
  getConfig() {
    return {
      accessToken: process.env.META_ACCESS_TOKEN || dbService.getSetting('meta_access_token') || '',
      phoneNumberId: process.env.META_PHONE_NUMBER_ID || dbService.getSetting('meta_phone_number_id') || '',
      verifyToken: process.env.META_VERIFY_TOKEN || dbService.getSetting('meta_verify_token') || 'whatsapp_secret_agent_2026'
    };
  }

  isConfigured() {
    const { accessToken, phoneNumberId } = this.getConfig();
    return Boolean(accessToken && phoneNumberId);
  }

  async checkStatus() {
    const { accessToken, phoneNumberId } = this.getConfig();
    if (!accessToken || !phoneNumberId) {
      return {
        configured: false,
        status: 'warning',
        message: 'مفاتيح Meta API غير مكتملة بعد (Access Token أو Phone Number ID مفقود)'
      };
    }

    try {
      const response = await axios.get(
        `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          timeout: 7000
        }
      );
      return {
        configured: true,
        status: 'connected',
        phoneNumber: response.data.display_phone_number || response.data.id,
        verifiedName: response.data.verified_name || 'حساب واتساب تجاري',
        data: response.data
      };
    } catch (err) {
      const errorDetail = err.response?.data?.error?.message || err.message;
      return {
        configured: true,
        status: 'error',
        message: `فشل الاتصال بـ Meta: ${errorDetail}`
      };
    }
  }

  async sendTextMessage(toPhone, text) {
    const { accessToken, phoneNumberId } = this.getConfig();
    
    // Normalize phone number (digits only)
    const cleanPhone = toPhone.replace(/\D/g, '');

    if (!accessToken || !phoneNumberId) {
      console.warn(`[MetaService] Simulated Send to ${cleanPhone} (Tokens not configured yet): "${text}"`);
      return {
        success: true,
        simulated: true,
        messageId: 'sim_' + Date.now()
      };
    }

    try {
      const url = `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: {
          preview_url: false,
          body: text
        }
      };

      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const messageId = response.data?.messages?.[0]?.id || 'meta_' + Date.now();
      return {
        success: true,
        messageId,
        data: response.data
      };
    } catch (err) {
      console.error('[MetaService Error]', err.response?.data || err.message);
      throw new Error(err.response?.data?.error?.message || err.message);
    }
  }

  async sendTemplateMessage(toPhone, templateName = 'hello_world', languageCode = 'en_US') {
    const { accessToken, phoneNumberId } = this.getConfig();
    const cleanPhone = toPhone.replace(/\D/g, '');

    try {
      const url = `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: languageCode
          }
        }
      };

      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      return {
        success: true,
        messageId: response.data?.messages?.[0]?.id,
        data: response.data
      };
    } catch (err) {
      console.error('[MetaService Template Error]', err.response?.data || err.message);
      throw new Error(err.response?.data?.error?.message || err.message);
    }
  }

  async markAsRead(messageId) {
    const { accessToken, phoneNumberId } = this.getConfig();
    if (!accessToken || !phoneNumberId || !messageId || messageId.startsWith('sim_')) return;

    try {
      const url = `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`;
      await axios.post(url, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      }, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
    } catch (err) {
      // Ignored for read receipts
    }
  }
}

module.exports = new MetaService();
