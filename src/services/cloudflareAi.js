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
   * Strictly verify if the phone number belongs to the Owner (Mr. Ahmad Alamoudi)
   */
  isOwner(phone) {
    if (!phone) return false;
    const clean = String(phone).replace(/\D/g, '');
    return clean === AHMAD_PHONE || clean === '0782932611' || clean.endsWith('782932611');
  }

  /**
   * Robust phone number extraction for all Jordanian and international formats
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
        if (norm && !this.isOwner(norm)) {
          normalized.push(norm);
        }
      }
    }
    return [...new Set(normalized)];
  }

  /**
   * Helper to call Cloudflare Workers AI with low temperature (anti-hallucination)
   */
  async callCloudflare(messages, expectJson = false, maxTokens = 350) {
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
            max_tokens: maxTokens
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
   * Retrieve all owner permanent memories formatted for prompt injection
   */
  getOwnerMemoriesSummary() {
    try {
      const memories = dbService.getMemories({ classification: 'owner', limit: 15 });
      if (!memories || memories.length === 0) return 'لا توجد معلومات إضافية مسجلة بعد.';
      return memories.map(m => `- ${m.content}`).join('\n');
    } catch (_) {
      return 'لا توجد معلومات إضافية مسجلة بعد.';
    }
  }

  /**
   * Retrieve chronological conversation history between Ahmad and Nashmi
   */
  getRecentAhmadChatContext(limit = 10) {
    try {
      const raw = dbService.getMessages(AHMAD_PHONE, limit);
      if (!raw || raw.length === 0) return [];
      // reverse to chronological order
      const sorted = [...raw].reverse();
      return sorted.map(m => ({
        role: m.direction === 'incoming' ? 'user' : 'assistant',
        content: m.text || ''
      }));
    } catch (_) {
      return [];
    }
  }

  /**
   * Main generation entry point
   */
  async generateReply({ fromPhone, senderName, incomingText }) {
    const isOwner = this.isOwner(fromPhone);

    // =========================================================================
    // 👑 1. OWNER FLOW: MR. AHMAD ALAMOUDI (FULL EXECUTIVE AGENT CORE)
    // =========================================================================
    if (isOwner) {
      console.log(`👑 [Executive Secretary] Instruction from Ahmad Alamoudi: "${incomingText}"`);

      // -----------------------------------------------------------------------
      // A. Dynamic Fact & Instruction Learner (Ahmad teaching Nashmi)
      // -----------------------------------------------------------------------
      const isTeachingIntent = /(?:احفظ|احفظلي|سجل عندك|تذكر|خلي ببالك|بدي تعرف|بدي ياك تعرف|لا تنسى|معلومة مهمة|ابوي اسمه|امي اسمها|اخوي اسمه|صاحبي اسمه|شريكي هو)/iu.test(incomingText);
      if (isTeachingIntent) {
        try {
          const extractPrompt = `
الأستاذ أحمد العامودي يعلمك أو يطلب منك حفظ معلومة جديدة أو حقيقة في الذاكرة الدائمة.
استخرج المعلومة الأساسية فقط بدقة وبشكل موجز:
نص الأستاذ أحمد: "${incomingText}"

المطلوب:
اكتب الحقيقة أو المعلومة فقط كنص مباشر للحفظ في الذاكرة (بدون كلمة "احفظ انو" أو مقدمات).
`;
          const learnedFact = await this.callCloudflare([{ role: 'user', content: extractPrompt }], false, 150);
          const finalFact = (learnedFact && learnedFact.length > 3) ? learnedFact : incomingText.replace(/^(احفظ انو|سجل عندك انو|تذكر انو|خلي ببالك انو)\s*/iu, '');

          dbService.addMemory({
            entity_phone: AHMAD_PHONE,
            entity_name: 'أحمد العامودي',
            memory_type: 'long_term',
            classification: 'owner',
            content: finalFact,
            evidence_source: 'Ahmad direct statement',
            confidence: 1.0
          });

          console.log(`💾 [Memory Engine] Stored permanent fact for Ahmad: "${finalFact}"`);
          return `أبشر أستاذ أحمد، من عيوني الثنتين! سجلت وحفظت هاي المعلومة عندي بالذاكرة الدائمة وما بنساها أبداً 🌸:\n"${finalFact}" 👍`;
        } catch (e) {
          console.warn('Failed to record memory:', e.message);
        }
      }

      // -----------------------------------------------------------------------
      // B. Calendar & Scheduling Actions (Meetings, Appointments, Calendar)
      // -----------------------------------------------------------------------
      const isCalendarSchedule = /(?:سجل موعد|حطلي موعد|ضيف موعد|جدول موعد|سجل عندي اجتماع|عندي موعد|عندي اجتماع مع)/iu.test(incomingText);
      const isCalendarQuery = /(?:شو عندي مواعيد|شو جدولي|شو المواعيد|عندي اشي اليوم|عندي اشي بكرة|التقويم|جدول أعمالي)/iu.test(incomingText);

      if (isCalendarSchedule) {
        try {
          const extractCal = `
استخرج بيانات الموعد أو الاجتماع من كلام الأستاذ أحمد بصيغة JSON فقط:
كلام أحمد: "${incomingText}"

الصيغة المطلوبة JSON فقط:
{
  "title": "عنوان الاجتماع أو الموعد",
  "time": "الوقت والتاريخ المذكور أو 'قريباً'",
  "location": "المكان إن ذكر أو 'المكتب'"
}
`;
          const calData = await this.callCloudflare([{ role: 'user', content: extractCal }], true, 150);
          if (calData && calData.title) {
            dbService.createCalendarEvent?.({
              title: calData.title,
              participant_name: 'الأستاذ أحمد العامودي',
              start_time: calData.time || 'قريباً',
              location: calData.location || 'المكتب',
              notes: incomingText,
              created_by: 'نشمي'
            });

            return `أبشر أستاذ أحمد، تم تثبيت وتسجيل الموعد بالتقويم بنجاح 📅:\n- **الموعد**: ${calData.title}\n- **التوقيت**: ${calData.time}\n- **المكان**: ${calData.location} 👍`;
          }
        } catch (_) {}
      }

      if (isCalendarQuery) {
        try {
          const events = dbService.getCalendarEvents ? dbService.getCalendarEvents({ limit: 5 }) : [];
          if (!events || events.length === 0) {
            return `أستاذ أحمد، شيكتلك على التقويم وما في أي مواعيد أو اجتماعات مسجلة حالياً، الجدول فاضي وجاهز لأي ترتيبات بتحبها 🌸`;
          }
          const eventList = events.map(e => `📅 [${e.title}] - التوقيت: ${e.start_time || 'غير محدد'} (${e.location || 'المكتب'})`).join('\n');
          return `أستاذ أحمد، هي المواعيد المسجلة عندك بالتقويم:\n\n${eventList}\n\nجاهز لأي تعديل أو إضافة بتحبها 👍`;
        } catch (_) {}
      }

      // -----------------------------------------------------------------------
      // C. Target Phone Actions: Contacting (Send Message/Dinner/Meeting) OR History Query
      // -----------------------------------------------------------------------
      const extractedPhones = this.extractPhoneNumbers(incomingText);

      if (extractedPhones.length > 0) {
        const targetPhone = extractedPhones[0];

        // 1. History / conversation record query
        const isHistoryQuery = /(?:شو حكى|شو قال|شو حكيت|شو في بينك|شو صار معه|وين وصلت|شو بعث|شو رده|شو رد|تاريخ|سجل|محادثات)/iu.test(incomingText);
        if (isHistoryQuery) {
          console.log(`🔍 [Nashmi Query] Checking DB history for: ${targetPhone}`);
          const messages = dbService.getMessages(targetPhone, 15);
          if (!messages || messages.length === 0) {
            return `أستاذ أحمد، شيكتلك على السجل للرقم (${targetPhone})، وما في أي رسائل مسجلة عندي معه بالسيستم نهائياً 🌸`;
          }

          const historyText = messages.map(m => `[${m.created_at}] [${m.direction === 'incoming' ? 'الطرف الآخر' : 'نشمي'}]: ${m.text}`).join('\n');
          const summarizePrompt = `
أنت "نشمي"، المساعد التنفيذي للأستاذ أحمد العامودي.
يسألك الأستاذ أحمد عما دار بيننا وبين الرقم (${targetPhone}).
هذا سجل المحادثة الحقيقي المسترجع من قاعدة البيانات:
${historyText}

قواعد صارمة ضد الهلوسة:
1. التزم 100% فقط بالنصوص والتواريخ المذكورة بالسجل أعلاه، وممنوع نهائياً اختراع أي تفاصيل ليست بالسجل.
2. لخص للأستاذ أحمد باختصار ودقة وصدق بلهجة أردنية لبقة: متى كان آخر تواصل وماذا قال الطرف الآخر.
`;

          const summary = await this.callCloudflare([
            { role: 'system', content: summarizePrompt },
            { role: 'user', content: incomingText }
          ], false);

          return summary || `أستاذ أحمد، شيكتلك على السجل للرقم (${targetPhone}). في ${messages.length} رسالة مسجلة، وآخر رسالة كانت: "${messages[messages.length - 1].text.slice(0, 60)}" 👍`;
        }

        // 2. Active Outbound Action (Send message, dinner invite, meeting, order, errand)
        console.log(`🚀 [Nashmi Action] Executing outbound contact to: ${targetPhone}`);

        const craftPrompt = `
أنت "نشمي"، المساعد الشخصي للأستاذ أحمد العامودي.
طلب منك الأستاذ أحمد التواصل مع طرف آخر بهذه التعليمات:
"${incomingText}"

المطلوب:
اكتب نص الرسالة التي ستُرسل لهذا الطرف عبر واتساب نيابة عن مكتب وسفريات الأستاذ أحمد العامودي بلهجة أردنية مهذبة ومباشرة.
(مثال: مرحباً بك، يتواصل معك مكتب الأستاذ أحمد العامودي بخصوص...).
اكتب فقط نص الرسالة التي ستُرسل إليه بدون أي كلام خارجي أو مقدمات.
`;

        let msgToSend = await this.callCloudflare([{ role: 'user', content: craftPrompt }], false, 200);
        if (!msgToSend || msgToSend.length < 5) {
          msgToSend = `مرحباً بك 🌸 يتواصل معك مكتب وسفريات الأستاذ أحمد العامودي بخصوص: ${incomingText}`;
        }
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

          // Record in agent_tasks
          try {
            dbService.createTask?.({
              taskCode: 'TASK_' + Date.now(),
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

      // Check if Ahmad commanded to send without providing phone
      const wantsToSendWithoutPhone = /(?:احكي مع|تواصل مع|ابعث|ارسل|رتب|نسق)\s+/iu.test(incomingText);
      if (wantsToSendWithoutPhone && extractedPhones.length === 0) {
        return `أبشر أستاذ أحمد، من عيوني الثنتين! بس يا ريت تبعثلي رقم الهاتف حتى أتواصل معه وأرتب الموضوع فوراً 🌸`;
      }

      // -----------------------------------------------------------------------
      // D. Memory Recall Query (Ahmad asking what Nashmi remembers)
      // -----------------------------------------------------------------------
      const isMemoryRecallQuery = /(?:شو بتعرف عن|متذكر شو حكيتلك|شو حكيتلك عن|بتتذكر|ذاكرتك|شو مسجل عندك)/iu.test(incomingText);
      if (isMemoryRecallQuery) {
        const ownerMemories = this.getOwnerMemoriesSummary();
        const recallPrompt = `
أنت "نشمي"، المساعد الشخصي والتنفيذي الذكي للأستاذ أحمد العامودي.
يسألك الأستاذ أحمد عما تتذكره أو ما هو محفوظ في ذاكرتك الدائمة.

الذاكرة الدائمة والحقائق المحفوظة في قاعدة البيانات:
${ownerMemories}

قواعد صارمة ضد الهلوسة:
1. أجب الأستاذ أحمد بناءً على الحقائق المحفوظة أعلاه فقط بكل دقة وصدق.
2. إذا كانت المعلومة غير موجودة في الذاكرة أعلاه، قل له بصراحة وأدب: "ما تم تسجيل أو حفظ هاي المعلومة عندي بعد أستاذ أحمد، بتحب أسجلها هسا؟".
`;
        const recallReply = await this.callCloudflare([
          { role: 'system', content: recallPrompt },
          { role: 'user', content: incomingText }
        ], false, 250);

        if (recallReply) return recallReply;
      }

      // -----------------------------------------------------------------------
      // E. Continuous Multi-Turn Executive Dialogue (With Chat History & Stored Memories)
      // -----------------------------------------------------------------------
      const ownerMemories = this.getOwnerMemoriesSummary();
      const recentChatContext = this.getRecentAhmadChatContext(10);

      const systemPrompt = `
أنت "نشمي"، المساعد الشخصي والتنفيذي الذكي والمخلص للأستاذ أحمد العامودي (مكتب وسفريات سند تاكسي والأعمال).
المتحدث معك الآن هو الأستاذ أحمد العامودي حصراً (صاحب العمل والمدير العام).
أنت تعرفه تماماً وتخاطبه دائماً بـ (أستاذ أحمد / يا هلا والله أستاذ أحمد، أبشر، تكرم عينك، من عيوني الثنتين، أمرك أستاذي).

معلومات الذاكرة الدائمة المحفوظة عن الأستاذ أحمد والمكتب:
${ownerMemories}

قواعد السلوك ومنع الهلوسة:
1. أنت سكرتير ومساعد عمل وتنفيذ ذكي وحقيقي؛ أجب باختصار وواقعية وصدق كإنسان طبيعي.
2. إذا سألك أحمد "شو الأخبار" أو "كيف الأمور": قل له ببساطة إن كل أمور المكتب والعمل تمام والحمد لله، وأنا بانتظار توجيهاتك وأوامرك.
3. التزم بسياق المحادثة الأخيرة والأوامر السابقة بدقة دون تكرار أو نسيان.
4. ممنوع نهائياً اختراع أو تأليف أي وقائع أو أحداث من خيالك.
`;

      const messages = [{ role: 'system', content: systemPrompt }];

      // Append chronological recent chat history
      if (recentChatContext.length > 0) {
        for (const item of recentChatContext) {
          messages.push(item);
        }
      }

      // Ensure the latest message is the user prompt
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'user' || last.content !== incomingText) {
        messages.push({ role: 'user', content: incomingText });
      }

      const reply = await this.callCloudflare(messages, false, 300);
      return reply || `يا هلا والله أستاذ أحمد 🌸 أخوك نشمي معك وسامعك، شو حابب نرتب أو ننجز هسا؟`;
    }

    // =========================================================================
    // 👤 2. EXTERNAL VISITOR / CLIENT FLOW (Sanad Taxi & Office Support)
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

    const recentHistory = dbService.getRecentContext ? dbService.getRecentContext(fromPhone.replace(/\D/g, ''), 4) : [];
    const messages = [{ role: 'system', content: clientPrompt }];

    for (const h of recentHistory) {
      if (h.direction === 'incoming') messages.push({ role: 'user', content: h.text || '' });
      else if (h.direction === 'outgoing') messages.push({ role: 'assistant', content: h.text || '' });
    }
    messages.push({ role: 'user', content: incomingText });

    const reply = await this.callCloudflare(messages, false, 250);
    return reply || `أهلاً وسهلاً بحضرتك في مكتب وسفريات الأستاذ أحمد العامودي 🌸 تفضل كيف بقدر أساعدك وأخدمك اليوم؟`;
  }
}

module.exports = new CloudflareAiService();
