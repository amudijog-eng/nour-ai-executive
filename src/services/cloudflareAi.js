require('dotenv').config();
const axios = require('axios');
const dbService = require('../db/database');
const metaService = require('./metaService');
const authentication = require('../security/authentication');
const identityResolver = require('../people/identity-resolution/identityResolver');

const AHMAD_PHONE = '962782932611';

class CloudflareAiService {
  constructor() {
    this.primaryModel = process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.1-8b-instruct';
    this.fallbackModel = '@cf/meta/llama-3.2-3b-instruct';
  }

  getConfig() {
    return {
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID || dbService.getSetting('cloudflare_account_id') || '',
      apiToken: process.env.CLOUDFLARE_API_TOKEN || dbService.getSetting('cloudflare_api_token') || ''
    };
  }

  /**
   * Helper to call Cloudflare Workers AI with fallback and strict low temperature
   */
  async callCloudflare(messages, expectJson = false) {
    const { accountId, apiToken } = this.getConfig();
    if (!accountId || !apiToken) {
      console.warn('⚠️ [Cloudflare AI] Missing accountId or apiToken');
      return null;
    }

    const models = [this.primaryModel, this.fallbackModel];
    for (const model of models) {
      try {
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
        const res = await axios.post(
          url,
          {
            messages,
            temperature: 0.1,
            max_tokens: 350
          },
          {
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000
          }
        );

        let resp = res.data?.result?.response;
        if (!resp && res.data?.result?.choices?.[0]?.message?.content) {
          resp = res.data.result.choices[0].message.content;
        }

        if (expectJson) {
          if (typeof resp === 'object' && resp !== null) return resp;
          if (typeof resp === 'string') {
            try {
              const match = resp.match(/\{[\s\S]*\}/);
              if (match) {
                try {
                  return JSON.parse(match[0]);
                } catch (_) {
                  return (new Function('return ' + match[0]))();
                }
              }
            } catch (_) {}
          }
        } else {
          if (typeof resp === 'string' && resp.trim()) {
            return resp.replace(/^["']|["']$/g, '').trim();
          }
        }
      } catch (err) {
        console.warn(`⚠️ [Cloudflare AI (${model})] Error:`, err.response?.data?.errors || err.message);
      }
    }
    return null;
  }

  /**
   * Main generation method for incoming WhatsApp messages
   */
  async generateReply({ fromPhone, senderName, incomingText }) {
    const cleanPhone = (fromPhone || '').replace(/\D/g, '');
    const isOwner = cleanPhone === AHMAD_PHONE || cleanPhone === '0782932611';

    // =========================================================================
    // 1. OWNER FLOW (Ahmad Alamoudi - Intelligent Executive Agent "Nashmi")
    // =========================================================================
    if (isOwner) {
      console.log(`👑 [Nashmi Agent] Ahmad instruction: "${incomingText}"`);

      const analyzePrompt = `
أنت "نشمي"، المساعد الشخصي والتنفيذي الذكي للأستاذ أحمد العامودي.
الأستاذ أحمد هو صاحب العمل والمدير الوحيد. يفهم نظامك أي كلام طبيعي بدون أوامر ثابتة وبدون هلوسة.

قواعد صارمة ضد الهلوسة:
1. ممنوع نهائياً اختراع أو تأليف أي أسماء، أحداث، أو معلومات غير واردة في رسالة الأستاذ أحمد.
2. حلل رسالته بدقة وحدد الإجراء بصيغة JSON فقط:
   - SEND_MESSAGE: إذا طلب إرسال رسالة أو التواصل أو إبلاغ شخص أو رقم بأمر ما.
   - QUERY_HISTORY: إذا استفسر عما قاله شخص أو رقم، أو سأل "شو حكى معك؟" أو "شو وصلك منه؟".
   - CONVERSATION: إذا كان كلامه تحية، سؤال عام، دردشة عادية، استشارة، أو نقاش.

الصيغة المطلوبة JSON فقط بدون أي نص خارجها:
{
  "action": "SEND_MESSAGE" | "QUERY_HISTORY" | "CONVERSATION",
  "targetPhone": "رقم الهاتف إن وجد في النص أو null",
  "targetName": "اسم الشخص أو الجهة إن ذكرت أو null",
  "messageToSend": "نص الرسالة المطلوب إرسالها للطرف الآخر بدقة وبدون زيادة أو null",
  "reply": "ردك الطبيعي واللبق للأستاذ أحمد باللهجة الأردنية اللطيفة بصفة نشمي إن كان حواراً عادياً"
}
`;

      const decision = await this.callCloudflare([
        { role: 'system', content: analyzePrompt },
        { role: 'user', content: incomingText }
      ], true);

      // --- CASE A: Action to Send a WhatsApp Message to Another Person ---
      if (decision && decision.action === 'SEND_MESSAGE') {
        let targetPhone = decision.targetPhone ? authentication.normalizePhone(decision.targetPhone) : null;

        // If phone wasn't extracted directly, try resolving name
        if (!targetPhone && decision.targetName) {
          try {
            const resolved = await identityResolver.resolve(decision.targetName);
            if (resolved && resolved.phone && resolved.phone !== AHMAD_PHONE) {
              targetPhone = resolved.phone;
            }
          } catch (_) {}
        }

        const msgToSend = decision.messageToSend;

        if (!targetPhone) {
          return `أبشر أستاذ أحمد، من عيوني! بس يا ريت تبلغني برقم الهاتف اللي حابب أبعث له الرسالة 🌸`;
        }

        if (!msgToSend) {
          return `أبشر أستاذ أحمد! شيكت على الرقم (${targetPhone})، بس شو نص الرسالة اللي حابب أكتب له إياها؟ 🌸`;
        }

        // Dispatch outbound WhatsApp message
        try {
          console.log(`📤 [Nashmi Dispatch] Sending WhatsApp to ${targetPhone}: "${msgToSend}"`);
          const sendRes = await metaService.sendTextMessage(targetPhone, msgToSend);
          dbService.saveMessage({
            messageId: sendRes?.messageId || 'out_' + Date.now(),
            phone: targetPhone,
            direction: 'outgoing',
            text: msgToSend,
            type: 'text',
            status: 'sent'
          });

          return `أبشر أستاذ أحمد، من عيوني الثنتين! أخوك نشمي بعث الرسالة فوراً للرقم (${targetPhone}):
"${msgToSend}" 👍`;
        } catch (err) {
          console.error('❌ Failed to dispatch message:', err.message);
          return `أستاذ أحمد، حاولت أبعث للرقم (${targetPhone}) بس طلع خطأ في الإرسال: ${err.message}`;
        }
      }

      // --- CASE B: Action to Query Conversation History with a Person/Number ---
      if (decision && decision.action === 'QUERY_HISTORY') {
        let targetPhone = decision.targetPhone ? authentication.normalizePhone(decision.targetPhone) : null;
        let displayName = decision.targetName || targetPhone;

        if (!targetPhone && decision.targetName) {
          try {
            const resolved = await identityResolver.resolve(decision.targetName);
            if (resolved && resolved.phone && resolved.phone !== AHMAD_PHONE) {
              targetPhone = resolved.phone;
              displayName = resolved.name || decision.targetName;
            }
          } catch (_) {}
        }

        if (!targetPhone) {
          return `يا هلا أستاذ أحمد. عن أي رقم أو شخص حابب أشيكلك على محادثاته؟ يا ريت تذكرلي اسمه أو رقمه 🌸`;
        }

        const messages = dbService.getMessages(targetPhone, 15);
        if (!messages || messages.length === 0) {
          return `أستاذ أحمد، شيكتلك على السجل للرقم (${targetPhone})، وما في أي رسائل سابقة مسجلة عندي معه 🌸`;
        }

        // Summarize history via Cloudflare AI strictly based on retrieved messages
        const historyText = messages.map(m => `[${m.created_at}] [${m.direction === 'incoming' ? (displayName || 'الطرف الآخر') : 'نشمي المساعد'}]: ${m.text}`).join('\n');
        const summarizePrompt = `
أنت "نشمي"، المساعد التنفيذي للأستاذ أحمد العامودي.
يسألك الأستاذ أحمد عما دار بيننا وبين (${displayName || targetPhone}).
هذا سجل المحادثة الحقيقي المسترجع من قاعدة البيانات:
${historyText}

قواعد صارمة ضد الهلوسة:
1. التزم 100% فقط بالنصوص والتواريخ المذكورة بالسجل أعلاه، وممنوع منعاً باتاً اختراع أي وقائع أو تفاصيل ليست في السجل.
2. لخص للأستاذ أحمد باختصار ودقة وصدق بلهجة أردنية لبقة:
   - متى كان آخر تواصل وماذا قال الطرف الآخر.
   - هل هو بانتظار رد أم أن الموضوع منتهٍ.
3. إذا كان السجل قصيراً أو لا يحتوي على تفاصيل كافية، قل له ما هو موجود فقط بكل أمانة.
`;

        const summary = await this.callCloudflare([
          { role: 'system', content: summarizePrompt },
          { role: 'user', content: incomingText }
        ], false);

        if (summary) return summary;

        return `أستاذ أحمد، شيكتلك على سجل (${displayName || targetPhone}). في ${messages.length} رسالة مسجلة، وآخر رسالة كانت: "${messages[messages.length - 1].text.slice(0, 70)}" 👍`;
      }

      // --- CASE C: Normal Dialogue & Executive Consultation ---
      if (decision && decision.reply) {
        return decision.reply;
      }

      // Grounded conversation prompt with history
      const history = dbService.getRecentContext ? dbService.getRecentContext(cleanPhone, 4) : [];
      const messages = [
        {
          role: 'system',
          content: `أنت "نشمي"، المساعد الشخصي والتنفيذي الذكي للأستاذ أحمد العامودي (مكتب وسفريات سند تاكسي والأعمال).
أسلوبك: رجل أردني شهم، لبق، صادق، ومخلص جداً (يا هلا والله أستاذ أحمد، أبشر، تكرم عينك، من عيوني الثنتين، أمرك أستاذي).
قواعد صارمة ضد الهلوسة:
1. أنت مساعد تنفيذي ومكتب وعمل، ولست نشرة أخبار عامة؛ لا تخترع أخباراً سياسية أو معلومات عامة من خيالك.
2. إذا سألك أحمد "شو الأخبار" أو "كيف الأمور": قل له ببساطة إن كل أمور المكتب والعمل تمام والحمد لله، وأنا بانتظار توجيهاتك وأوامرك.
3. كن دقيقاً، صادقاً، ومباشراً بدون فلسفة أو مبالغة.`
        }
      ];

      for (const h of history) {
        if (h.direction === 'incoming') messages.push({ role: 'user', content: h.text || '' });
        else if (h.direction === 'outgoing') messages.push({ role: 'assistant', content: h.text || '' });
      }
      messages.push({ role: 'user', content: incomingText });

      const reply = await this.callCloudflare(messages, false);
      if (reply) return reply;

      return `يا هلا والله أستاذ أحمد 🌸 أخوك نشمي معك وسامعك، شو حابب نرتب أو ننجز هسا؟`;
    }

    // =========================================================================
    // 2. EXTERNAL VISITOR / CLIENT FLOW (Sanad Taxi & Office Support)
    // =========================================================================
    console.log(`👤 [Nashmi Client] Message from ${fromPhone} (${senderName}): "${incomingText}"`);
    const history = dbService.getRecentContext ? dbService.getRecentContext(cleanPhone, 4) : [];
    const messages = [
      {
        role: 'system',
        content: `أنت "نشمي"، مساعد وممثل خدمة العملاء في مكتب وسفريات الأستاذ أحمد العامودي (سند تاكسي).
أسلوبك: شهم ومهذب، بلهجة أردنية لطيفة (يا هلا بحضرتك، أهلاً وسهلاً، تكرم، تفضل كيف بقدر أخدمك اليوم؟).
قواعد صارمة ضد الهلوسة:
1. ممنوع نهائياً اختراع أسماء شركات وهمية أو أسماء أشخاص أو سائقين أو أسعار من عندك.
2. إذا طلب العميل تكسي أو توصيل، رحب به واطلب منه تحديد: مكان الانطلاق، الوجهة، والوقت المطلوب لترتيب الحجز له.
3. كن صادقاً وواضحاً ومباشراً بدون فلسفة.`
      }
    ];

    for (const h of history) {
      if (h.direction === 'incoming') messages.push({ role: 'user', content: h.text || '' });
      else if (h.direction === 'outgoing') messages.push({ role: 'assistant', content: h.text || '' });
    }
    messages.push({ role: 'user', content: incomingText });

    const reply = await this.callCloudflare(messages, false);
    if (reply) return reply;

    return `أهلاً وسهلاً بحضرتك في مكتب وسفريات الأستاذ أحمد العامودي 🌸 تفضل كيف بقدر أساعدك وأخدمك اليوم؟`;
  }
}

module.exports = new CloudflareAiService();
