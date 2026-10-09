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
   * Helper to extract valid phone numbers from any Arabic text format
   */
  extractPhoneNumbers(text) {
    if (!text) return [];
    const clean = text.replace(/[\u200E\u200F\u202A-\u202E\u00A0\u200B-\u200D\uFEFF]/g, ' ');
    const candidates = clean.match(/(?:\+?[0-9][0-9\s\-]{8,18}[0-9])/g) || [];
    const normalized = [];
    for (const c of candidates) {
      const digits = c.replace(/\D/g, '');
      if (digits.length >= 9 && digits.length <= 15) {
        const norm = authentication.normalizePhone(digits);
        if (norm && norm !== AHMAD_PHONE) {
          normalized.push(norm);
        }
      }
    }
    return [...new Set(normalized)];
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
            max_tokens: 300
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

      // A. Extract phone numbers from Ahmad's message
      const extractedPhones = this.extractPhoneNumbers(incomingText);

      // --- CASE 1: A specific phone number was mentioned ---
      if (extractedPhones.length > 0) {
        const targetPhone = extractedPhones[0];

        // Check if Ahmad is inquiring about conversation history
        const isHistoryQuery = /(?:شو حكى|شو قال|شو حكيت|شو في بينك|شو صار معه|وين وصلت|شو بعث|شو رده|شو رد|تاريخ|سجل|محادثات)/iu.test(incomingText);
        if (isHistoryQuery) {
          console.log(`🔍 [Nashmi Query] Checking DB history for: ${targetPhone}`);
          const messages = dbService.getMessages(targetPhone, 15);
          if (!messages || messages.length === 0) {
            return `أستاذ أحمد، شيكتلك على السجل للرقم (${targetPhone})، وما في أي رسائل مسجلة عندي معه بالسيستم نهائياً 🌸`;
          }

          const historyText = messages.map(m => `[${m.created_at}] [${m.direction === 'incoming' ? 'الطرف الآخر' : 'نشمي'}] : ${m.text}`).join('\n');
          const summarizePrompt = `
أنت "نشمي"، المساعد التنفيذي للأستاذ أحمد العامودي.
يسألك الأستاذ أحمد عما دار بيننا وبين الرقم (${targetPhone}).
هذا سجل المحادثة الحقيقي من قاعدة البيانات:
${historyText}

قواعد صارمة ضد الهلوسة:
1. التزم 100% فقط بالنصوص والتواريخ المذكورة بالسجل أعلاه، وممنوع نهائياً اختراع أي تفاصيل خارج السجل.
2. لخص للأستاذ أحمد باختصار ودقة وصدق بلهجة أردنية لبقة:
   - متى كان آخر تواصل وماذا قال الطرف الآخر.
   - هل هو بانتظار رد أم لا.
`;

          const summary = await this.callCloudflare([
            { role: 'system', content: summarizePrompt },
            { role: 'user', content: incomingText }
          ], false);

          return summary || `أستاذ أحمد، شيكتلك على السجل للرقم (${targetPhone}). في ${messages.length} رسالة مسجلة، وآخر رسالة كانت: "${messages[messages.length - 1].text.slice(0, 60)}" 👍`;
        }

        // Otherwise: Ahmad is giving an active command to CONTACT this number (Meeting, Dinner, Message, Errand)!
        console.log(`🚀 [Nashmi Action] Executing outbound contact to: ${targetPhone}`);

        // Craft courteous message on behalf of Mr. Ahmad Alamoudi
        const craftPrompt = `
أنت "نشمي"، المساعد الشخصي للأستاذ أحمد العامودي.
طلب منك الأستاذ أحمد التواصل مع طرف آخر بهذه التعليمات:
"${incomingText}"

المطلوب:
اكتب نص الرسالة التي ستُرسل لهذا الطرف عبر واتساب نيابة عن مكتب وسفريات الأستاذ أحمد العامودي بلهجة أردنية مهذبة ومباشرة.
(مثال: مرحباً بك، يتواصل معك مكتب الأستاذ أحمد العامودي...).
اكتب فقط نص الرسالة التي ستُرسل إليه بدون أي كلام خارجي أو مقدمات.
`;

        let msgToSend = await this.callCloudflare([
          { role: 'user', content: craftPrompt }
        ], false);

        if (!msgToSend || msgToSend.length < 5) {
          msgToSend = `مرحباً بك 🌸 يتواصل معك مكتب وسفريات الأستاذ أحمد العامودي بخصوص: ${incomingText}`;
        }

        // Clean up quotes
        msgToSend = msgToSend.replace(/^["']|["']$/g, '').trim();

        // ACTUALLY DISPATCH WHATSAPP MESSAGE
        try {
          console.log(`📤 [Meta Dispatch] Sending to ${targetPhone}: "${msgToSend}"`);
          const sendRes = await metaService.sendTextMessage(targetPhone, msgToSend);
          dbService.saveMessage({
            messageId: sendRes?.messageId || 'out_' + Date.now(),
            phone: targetPhone,
            direction: 'outgoing',
            text: msgToSend,
            type: 'text',
            status: 'sent'
          });

          // Record task in agent_tasks
          try {
            const taskCode = 'TASK_' + Date.now();
            dbService.createTask?.({
              taskCode,
              requesterPhone: AHMAD_PHONE,
              targetPhone,
              instruction: incomingText,
              lastAgentMessage: msgToSend
            });
          } catch (_) {}

          return `أبشر أستاذ أحمد، من عيوني الثنتين! أخوك نشمي تواصل فوراً مع الرقم (${targetPhone}) وبعثت له:

"${msgToSend}"

وأول ما يرد علي رح أرجعلك بكل التفاصيل فوراً 👍`;
        } catch (err) {
          console.error(`❌ [Meta Send Error] To ${targetPhone}:`, err.message);
          return `أستاذ أحمد، حاولت أبعث للرقم (${targetPhone}) بس طلع خطأ في الإرسال: ${err.message}`;
        }
      }

      // --- CASE 2: Check if Ahmad mentioned an action to send without a phone number ---
      const wantsToSend = /(?:احكي مع|تواصل مع|ابعث|ارسل|رتب|نسق)\s+/iu.test(incomingText);
      if (wantsToSend && extractedPhones.length === 0) {
        return `أبشر أستاذ أحمد، من عيوني الثنتين! بس يا ريت تبعثلي رقم الهاتف اللي حابب أتواصل معه وأرتب الموضوع 🌸`;
      }

      // --- CASE 3: General Executive Conversation ---
      const chatPrompt = `
أنت "نشمي"، المساعد الشخصي والتنفيذي الذكي للأستاذ أحمد العامودي (مكتب وسفريات سند تاكسي والأعمال).
أسلوبك: رجل أردني شهم، لبق، صادق، ومخلص جداً (يا هلا والله أستاذ أحمد، أبشر، تكرم عينك، من عيوني الثنتين، أمرك أستاذي).
قواعد صارمة ضد الهلوسة:
1. أنت مساعد تنفيذي ومكتب عمل؛ أجب بصدق واختصار وواقعية، وممنوع نهائياً اختراع أي أحداث أو وقائع أو معلومات من خيالك.
2. إذا سألك أحمد "شو الأخبار" أو "كيف الأمور": قل له ببساطة إن كل أمور المكتب والعمل تمام والحمد لله، وأنا بانتظار توجيهاتك وأوامرك.
3. كن دقيقاً ومباشراً بدون فلسفة أو مبالغة.
`;

      const reply = await this.callCloudflare([
        { role: 'system', content: chatPrompt },
        { role: 'user', content: incomingText }
      ], false);

      return reply || `يا هلا والله أستاذ أحمد 🌸 أخوك نشمي معك وسامعك، شو حابب نرتب أو ننجز هسا؟`;
    }

    // =========================================================================
    // 2. EXTERNAL VISITOR / CLIENT FLOW (Sanad Taxi & Office Support)
    // =========================================================================
    console.log(`👤 [Nashmi Client] Message from ${fromPhone} (${senderName}): "${incomingText}"`);

    const clientPrompt = `
أنت "نشمي"، مساعد وممثل خدمة العملاء في مكتب وسفريات الأستاذ أحمد العامودي (سند تاكسي).
أسلوبك: رجل أردني شهم ومهذب، بلهجة أردنية لطيفة ومحترمة (يا هلا بحضرتك، أهلاً وسهلاً، تكرم، تفضل كيف بقدر أخدمك اليوم؟).
قواعد صارمة ضد الهلوسة:
1. ممنوع نهائياً اختراع أسماء شركات وهمية أو أسماء سائقين أو أسعار من عندك.
2. إذا طلب العميل تكسي أو خدمة توصيل، رحب به واطلب منه تحديد: مكان الانطلاق، الوجهة، والوقت المطلوب لترتيب الحجز له.
3. كن صادقاً وواضحاً ومباشراً بدون فلسفة.
`;

    const reply = await this.callCloudflare([
      { role: 'system', content: clientPrompt },
      { role: 'user', content: incomingText }
    ], false);

    return reply || `أهلاً وسهلاً بحضرتك في مكتب وسفريات الأستاذ أحمد العامودي 🌸 تفضل كيف بقدر أساعدك وأخدمك اليوم؟`;
  }
}

module.exports = new CloudflareAiService();
