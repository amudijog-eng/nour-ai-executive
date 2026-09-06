const express = require('express');
const router = express.Router();
const otpService = require('../services/otpService');

router.post('/send', async (req, res) => {
  const { phone, length, expiresInMinutes } = req.body || {};

  if (!phone) {
    return res.status(400).json({ success: false, error: 'phone is required' });
  }

  try {
    const result = await otpService.generateAndSendOtp(phone, {
      length: length || 6,
      expiresInMinutes: expiresInMinutes || 10
    });

    return res.json({
      success: true,
      phone: result.phone,
      code: result.code,
      expiresInMinutes: result.expiresInMinutes,
      messageId: result.messageId
    });
  } catch (err) {
    console.error('[OTP Send Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
