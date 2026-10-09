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
   * Helper to call Cloudflare Workers AI with fallback
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
          { messages },
          {
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 12000
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
    // 1. OWNER FLOW (Ahmad Alamoudi - Intelligent Executive Agent)
    // =========================================================================
    if (isOwner) {
      console.log(`👑 [Cloudflare Agent] Ahmad instruction: "${incomingText}"`);

      const analyzePrompt = `
أنتِ العقل التنفيذي والذكي للسكرتيرة "نور" الخاصة بالأستاذ أحمد العامودي.
الأستاذ أحمد هو صاحب العمل الوحيد الذي يملك صلاحية توجيه المهام والاستفسار عن السجلات.
يفهم نظامك اللغة الطبيعية بدون أوامر ثابتة وبدون أي قيود جامدة.

المطلوب:
افهمي قصد الأستاذ أحمد بدقة وحددي الإجراء المطلوب بصيغة JSON فقط:
1. SEND_MESSAGE: إذا طلب إرسال رسالة أو التواصل أو إبلاغ رقم أو شخص بأمر ما.
2. QUERY_HISTORY: إذا استفسر عما قاله شخص أو رقم، أو سأل عن محادثات سابقة، أو سأل "شو حكى معك؟" أو "شو وصلك منه؟".
3. CONVERSATION: إذا كان كلامه تحية، سؤال عام، دردشة عادية، استشارة، أو نقاش.

الصيغة المطلوبة JSON فقط:
{
  "action": "SEND_MESSAGE" | "QUERY_HISTORY" | "CONVERSATION",
  "targetPhone": "رقم الهاتف إن وجد في النص أو null",
  "targetName": "اسم الشخص أو الجهة إن ذكرت أو null",
  "messageToSend": "نص الرسالة المطلوب إرسالها للطرف الآخر أو null",
  "reply": "ردك الطبيعي واللبق للأستاذ أحمد باللهجة الأردنية اللطيفة إن كان حواراً عادياً"
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
          return `أبشر أستاذ أحمد! شيكت على الرقم (${targetPhone})، بس شو الرسالة اللي حابب أكتب له إياها؟ 🌸`;
        }

        // Dispatch outbound WhatsApp message
        try {
          console.log(`📤 [Agent Dispatch] Sending WhatsApp to ${targetPhone}: "${msgToSend}"`);
          const sendRes = await metaService.sendTextMessage(targetPhone, msgToSend);
          dbService.saveMessage({
            messageId: sendRes?.messageId || 'out_' + Date.now(),
            phone: targetPhone,
            direction: 'outgoing',
            text: msgToSend,
            type: 'text',
            status: 'sent'
          });

          return `أبشر أستاذ أحمد، من عيوني الثنتين! بعثت الرسالة فوراً للرقم (${targetPhone}):
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
          return `أستاذ أحمد، شيكتلك على الرقم (${targetPhone}) وما في أي رسائل سابقة مسجلة عندي معه بالسجل 🌸`;
        }

        // Summarize history via Cloudflare AI
        const historyText = messages.map(m => `[${m.created_at}] [${m.direction === 'incoming' ? (displayName || 'الطرف الآخر') : 'نور السكرتيرة'}]: ${m.text}`).join('\n');
        const summarizePrompt = `
أنتِ "نور"، السكرتيرة التنفيذية للأستاذ أحمد العامودي.
يسألك الأستاذ أحمد عما دار بيننا وبين (${displayName || targetPhone}).
هذا سجل المحادثة الحقيقي من قاعدة البيانات:
${historyText}

المطلوب:
لخصي للأستاذ أحمد باختصار ودقة وذكاء بلهجة أردنية لبقة:
1. ما دار بينكم ومتى كان آخر تواصل.
2. ما هو آخر موقف واضح أو آخر ما تم الاتفاق عليه أو طلبه.
3. كوني دقيقة جداً وصريحة ولا تخترعي تفاصيل ليست بالسجل.
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

      // Fallback conversation prompt with history
      const history = dbService.getRecentContext ? dbService.getRecentContext(cleanPhone, 4) : [];
      const messages = [
        {
          role: 'system',
          content: `أنتِ "نور"، السكرتيرة والمساعدة التنفيذية الذكية للأستاذ أحمد العامودي. تحدثي بلهجة أردنية عفوية، لبقة، محترمة، وذكية كإنسان حقيقي (يا هلا والله أستاذ أحمد، أبشر، تكرم عينك، من عيوني، كيف بقدر أخدمك اليوم؟). كوني مساعدة طبيعية ومباشرة.`
        }
      ];

      for (const h of history) {
        if (h.direction === 'incoming') messages.push({ role: 'user', content: h.text || '' });
        else if (h.direction === 'outgoing') messages.push({ role: 'assistant', content: h.text || '' });
      }
      messages.push({ role: 'user', content: incomingText });

      const reply = await this.callCloudflare(messages, false);
      if (reply) return reply;

      return `يا هلا والله أستاذ أحمد 🌸 معك وسامعتك، شو حابب نرتب أو ننجز هسا؟`;
    }

    // =========================================================================
    // 2. EXTERNAL VISITOR / CLIENT FLOW
    // =========================================================================
    console.log(`👤 [Cloudflare Client] Message from ${fromPhone} (${senderName}): "${incomingText}"`);
    const history = dbService.getRecentContext ? dbService.getRecentContext(cleanPhone, 4) : [];
    const messages = [
      {
        role: 'system',
        content: `أنتِ "نور"، مساعدة وروبوت في مكتب الأستاذ أحمد العامودي (سند تاكسي والخدمات). تحدثي بلهجة أردنية محترمة، لطيفة، ومباشرة (يا هلا بحضرتك، أهلاً وسهلاً، تكرم، تفضل كيف بقدر أخدمك اليوم؟). ساعدي السائل بأدب واختصار ووضوح.`
      }
    ];

    for (const h of history) {
      if (h.direction === 'incoming') messages.push({ role: 'user', content: h.text || '' });
      else if (h.direction === 'outgoing') messages.push({ role: 'assistant', content: h.text || '' });
    }
    messages.push({ role: 'user', content: incomingText });

    const reply = await this.callCloudflare(messages, false);
    if (reply) return reply;

    return `أهلاً وسهلاً بحضرتك في مكتب الأستاذ أحمد العامودي 🌸 تفضل كيف بقدر أساعدك وأخدمك اليوم؟`;
  }
}

module.exports = new CloudflareAiService();
