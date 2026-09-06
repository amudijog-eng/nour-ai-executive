const metaService = require('./metaService');
const authentication = require('../security/authentication');

class OtpService {
  generateCode(length = 6) {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return String(Math.floor(min + Math.random() * (max - min + 1)));
  }

  async generateAndSendOtp(phone, { length = 6, expiresInMinutes = 10 } = {}) {
    const cleanPhone = authentication.normalizePhone(phone);
    if (!cleanPhone || cleanPhone.length < 9) {
      throw new Error(`Invalid phone number: "${phone}"`);
    }
    const code = this.generateCode(length);

    const messageText = `رمز التحقق الخاص بك لتطبيق Sanad Taxi هو: ${code}\nصالح لمدة ${expiresInMinutes} دقائق. لا تشارك هذا الرمز مع أي شخص.`;

    const sendRes = await metaService.sendTextMessage(cleanPhone, messageText);

    return {
      phone: cleanPhone,
      code,
      expiresInMinutes,
      messageId: sendRes?.messageId || null
    };
  }
}

module.exports = new OtpService();
