const axios = require('axios');
require('dotenv').config();

const renderUrl = process.argv[2];

if (!renderUrl) {
  console.log('❌ يرجى إدخال رابط سيرفر ريندر الخاص بك!');
  console.log('مثال: node set-render-webhook.js https://nour-ai-executive.onrender.com');
  process.exit(1);
}

const cleanUrl = renderUrl.replace(/\/$/, '') + '/webhook';
const appId = process.env.META_APP_ID || '8385584388183939';
const appSecret = process.env.META_APP_SECRET || 'da51fa96843fed218bb309ce80a76b6a';
const verifyToken = process.env.META_VERIFY_TOKEN || 'whatsapp_secret_agent_2026';

async function updateWebhook() {
  console.log(`🔄 جاري ربط وتحديث رابط ريندر في Meta Graph API:`);
  console.log(`🔗 الرابط الجديد: ${cleanUrl}`);

  try {
    const appToken = `${appId}|${appSecret}`;
    const url = `https://graph.facebook.com/v21.0/${appId}/subscriptions`;
    const res = await axios.post(url, null, {
      params: {
        access_token: appToken,
        object: 'whatsapp_business_account',
        callback_url: cleanUrl,
        verify_token: verifyToken,
        fields: 'messages'
      }
    });

    if (res.data?.success) {
      console.log('🎉 ===================================================');
      console.log('✅ تم ربط وتفعيل سيرفر Render بنجاح 100% مع WhatsApp!');
      console.log(`🌐 الآن سيرفرك يعمل مجاناً 24/7 دون الحاجة لجهازك الشخصي!`);
      console.log('===================================================');
    } else {
      console.log('استجابة ميتا:', res.data);
    }
  } catch (err) {
    console.error('❌ خطأ في تحديث ميتا:', err.response?.data || err.message);
  }
}

updateWebhook();
