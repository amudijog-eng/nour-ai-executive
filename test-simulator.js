/**
 * سكربت تجريبي لاختبار إرسال رسالة واتساب إلى الـ Webhook المحلي
 * يُحاكي وصول رسالة حقيقية من Meta Cloud API
 */
const axios = require('axios');

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = `http://localhost:${PORT}/webhook`;

async function simulateIncomingWhatsAppMessage() {
  console.log('🔄 إرسال طلب محاكاة رسالة واتساب إلى:', WEBHOOK_URL);

  const metaPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '962790000000',
                phone_number_id: 'TEST_PHONE_ID'
              },
              contacts: [
                {
                  profile: { name: 'عمر خالد (عميل تجريبي)' },
                  wa_id: '962798887766'
                }
              ],
              messages: [
                {
                  from: '962798887766',
                  id: 'wamid.HBg' + Date.now(),
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  text: { body: 'مرحبا، بدي استفسر عن إمكانية حجز موعد يوم الخميس القادم الساعة 5 مساءً' },
                  type: 'text'
                }
              ]
            },
            field: 'messages'
          }
        ]
      }
    ]
  };

  try {
    const res = await axios.post(WEBHOOK_URL, metaPayload);
    console.log('✅ تم استقبال الـ Webhook بنجاح من قبل السيرفر! كود الحالة:', res.status);
    console.log('افتح لوحة التحكم http://localhost:' + PORT + ' لمشاهدة المحادثة ورد السكرتيرة الذكية.');
  } catch (err) {
    console.error('❌ فشل إرسال الويب هوك:', err.message);
  }
}

simulateIncomingWhatsAppMessage();
