/**
 * Elegant Full-Stack Launcher
 * Starts Express Server + Cloudflare Tunnel + Auto-syncs Meta Webhook URL
 */
require('dotenv').config();
const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const APP_ID = process.env.META_APP_ID || '8385584388183939';
const APP_SECRET = process.env.META_APP_SECRET || 'da51fa96843fed218bb309ce80a76b6a';
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'whatsapp_secret_agent_2026';

console.log('🚀 [1/3] جاري تشغيل خادم Express وقاعدة البيانات...');
require('./src/server');


// Start Cloudflare Tunnel safely
const localCloudflared = path.join(__dirname, 'cloudflared.exe');
const cloudflaredPath = fs.existsSync(localCloudflared) ? localCloudflared : 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
if (fs.existsSync(cloudflaredPath)) {
  console.log('🌐 [2/3] جاري فتح النفق الآمن (Cloudflare Tunnel)...');
  const tunnelProc = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${PORT}`], {
    windowsHide: true
  });

  let tunnelUrlFound = false;

  tunnelProc.on('error', (err) => {
    console.warn('⚠️ [Tunnel Error]:', err.message);
  });

  tunnelProc.stderr.on('data', async (data) => {
    const line = data.toString();
    
    if (!tunnelUrlFound) {
      const match = line.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        tunnelUrlFound = true;
        const publicUrl = match[0];
        const webhookUrl = `${publicUrl}/webhook`;

        console.log(`🔗 [3/3] تم استخراج الرابط العام للنفق: ${publicUrl}`);
        console.log('⏳ انتظار 6 ثوانٍ لاكتمال انتشار DNS العالمي...');

        setTimeout(async () => {
          console.log('🔄 جاري تحديث ومزامنة رابط الـ Webhook تلقائياً في خوادم Meta...');
          try {
            const appToken = `${APP_ID}|${APP_SECRET}`;
            const syncRes = await axios.post(
              `https://graph.facebook.com/v21.0/${APP_ID}/subscriptions`,
              {
                object: 'whatsapp_business_account',
                callback_url: webhookUrl,
                verify_token: VERIFY_TOKEN,
                fields: ['messages', 'message_template_status_update']
              },
              {
                headers: { Authorization: `Bearer ${appToken}` }
              }
            );

            if (syncRes.data?.success) {
              console.log(`
========================================================================
🟢 نظام واتساب ويب ومكتب السيد أحمد العامودي يعمل الآن بنجاح!
------------------------------------------------------------------------
💻 لوحة تحكم واتساب ويب:     http://localhost:${PORT}
🌐 رابط Webhook المتصل بميتا:  ${webhookUrl}
🤖 محرك الذكاء الاصطناعي:    Google Antigravity Agent & CRM Engine
👤 المشرف العام:             أحمد العامودي (+962782932611)
📋 نظام التذاكر والـ CRM:     مفعّل وجاهز
========================================================================
              `);
            }
          } catch (err) {
            console.error('⚠️ [Meta Auto-sync Error]:', err.response?.data || err.message);
          }
        }, 6000);
      }
    }
  });

  tunnelProc.on('close', (code) => {
    console.log(`[Tunnel Process Exited with code ${code}]`);
  });
} else {
  console.log(`
========================================================================
🟢 سيرفر واتساب ومكتب السيد أحمد العامودي يعمل محلياً بنجاح!
------------------------------------------------------------------------
💻 لوحة التحكم والـ CRM:     http://localhost:${PORT}
🔗 رابط Webhook المحلي:       http://localhost:${PORT}/webhook
🤖 محرك الذكاء الاصطناعي:    Google Antigravity Agent & CRM Engine
👤 المشرف العام:             أحمد العامودي (+962782932611)
👥 نظام إدارة العملاء (CRM):   مفعّل
🚀 نظام المهام والتنسيق:       مفعّل
========================================================================
  `);
}
