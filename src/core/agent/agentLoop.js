
const axios = require('axios');
const dbService = require('../../db/database');
const authentication = require('../../security/authentication');
const identityResolver = require('../../people/identity-resolution/identityResolver');
const profileService = require('../../people/profiles/profileService');
const memoryEngine = require('../memory/memoryEngine');
const conversationRetrieval = require('../../conversations/retrieval/conversationRetrieval');
const conversationSummarizer = require('../../conversations/summarization/conversationSummarizer');
const taskEngine = require('../../tasks/engine/taskEngine');
const toolRegistry = require('../../tools/registry');
const accessControl = require('../permissions/accessControl');
const auditService = require('../../security/audit');

const MODEL_NAME = 'gemini-3.6-flash';

class AgentLoop {
  getApiKey() {
    return process.env.AI_API_KEY || dbService.getSetting('ai_api_key') || '';
  }

  /**
   * Main Entry Point for any WhatsApp message
   */
  async processMessage({ fromPhone, senderName, text }) {
    const cleanText = (text || '').trim();
    const apiKey = this.getApiKey();

    // 1. STEP 1: AUTHENTICATE & ACCESS CONTROL
    const auth = authentication.authenticate(fromPhone, cleanText);

    // Case A: Security Impersonator (Someone pretending to be Ahmad or giving orders from other numbers)
    if (auth.role === 'IMPERSONATOR') {
      console.warn(`🚨 [Security Threat Blocked] Impersonation attempt from ${fromPhone}: "${cleanText}"`);
      auditService.log({
        actorPhone: fromPhone,
        actorName: senderName,
        actionType: 'SECURITY_THREAT_BLOCKED',
        riskLevel: 'HIGH',
        authorizationStatus: 'BLOCKED',
        whyReason: auth.threatReason
      });

      const refusalReply = `أهلاً بحضرتك 🌸\nعذراً منك، الأستاذ أحمد العامودي هو المدير الحصري للنظام وله رقمه الشخصي المعتمد اللي بتواصل منه معنا (+962782932611)، وحفاظاً على الأمان لا يمكن تنفيذ أي أوامر أو إرسال رسائل إلا من رقمه المعتمد.\nإذا عندك أي استفسار أو حاب تتواصل مع الأستاذ أحمد أنا بالخدمة كرمالك 🌸`;
      const adminAlert = `🚨 *تنبيه أمني أستاذ أحمد:*
الرقم (+${fromPhone}) حاول إعطاء أمر أو الادعاء بأنه أنت قائلاً: "${cleanText}". تم حظر الطلب وإبلاغه أن الأوامر تصدر حصراً من رقمك المعتمد.`;

      return {
        action: 'SECURITY_BLOCKED',
        replyToCustomer: refusalReply,
        adminNotification: adminAlert
      };
    }

    // Case B: Check if fromPhone is replying to an active task (e.g. Khaled Salameh responding to invite)
    const activeTask = dbService.getActiveLifecycleTaskForPhone(fromPhone);
    if (activeTask && auth.role !== 'OWNER') {
      console.log(`🎯 [Active Task Reply] Phone ${fromPhone} replying to task ${activeTask.task_code}: "${cleanText}"`);
      const taskResult = await taskEngine.handleTargetReply(activeTask, cleanText, fromPhone);
      return {
        action: 'TASK_REPLY_HANDLED',
        replyToCustomer: taskResult.replyToTarget,
        adminNotification: taskResult.alertToAhmad,
        task: activeTask
      };
    }

    // Case C: Owner Dialogue & Executive Operations (Ahmad Alamoudi)
    if (auth.role === 'OWNER') {
      return this.handleOwnerInstruction(cleanText, apiKey);
    }

    // Case D: External Client / Visitor Dialogue
    return this.handleExternalClient(fromPhone, senderName, cleanText, apiKey);
  }

  /**
   * Executive Handler for Ahmad Alamoudi
   */
  async handleOwnerInstruction(cleanText, apiKey) {
    console.log(`👑 [Executive Agent Loop] Ahmad: "${cleanText}"`);

    // 1. Check if Ahmad is answering a support ticket (#TK-XXXX [الرد])
    const ticketMatch = cleanText.match(/(?:#)?(TK-\d{4})/i);
    if (ticketMatch) {
      const ticket = dbService.getTicketByNumber(ticketMatch[1].toUpperCase());
      if (ticket) {
        const cleanReply = cleanText.replace(/(?:#)?TK-\d{4}/gi, '').trim();
        dbService.updateTicketAdminReply(ticket.ticket_number, cleanReply);
        const customerMsg = `مرحبا أستاذ ${ticket.customer_name || ''} 🌸 يسعد أوقاتك.
الأستاذ أحمد العامودي راجع موضوعك (#${ticket.ticket_number}) وقلك:
"${cleanReply}"`;

        await toolRegistry.execute('whatsapp.send', {
          toPhone: ticket.customer_phone,
          messageText: customerMsg,
          reason: `Forward admin reply to ticket #${ticket.ticket_number}`
        });

        return {
          action: 'ADMIN_REPLY',
          replyToAhmad: `أبشر أستاذ أحمد، وصل ردك فوراً للعميل (${ticket.customer_name}) بخصوص التذكرة #${ticket.ticket_number} 👍`
        };
      }
    }

    // 2. Check for Direct WhatsApp Dispatch ("ابعتي رسالة لرقم 079... احكيله كذا")
    const directSendMatch = cleanText.match(/(?:ابعتي|ابعثي|ابعت|ابعث|ارسل|ارسلي|رسالة|مسج)\s+(?:رسالة\s+)?(?:لـ?لرقم|لـ?رقم|لـ?)\s*([0-9+]{9,15})[:\s]+(?:احكيله|احكي له|قله|قل له|نصها)?[:\s]*(.*)$/iu);
    if (directSendMatch) {
      let targetRawPhone = authentication.normalizePhone(directSendMatch[1]);
      let msgToSend = directSendMatch[2].trim();

      if (msgToSend) {
        try {
          await toolRegistry.execute('whatsapp.send', {
            toPhone: targetRawPhone,
            messageText: msgToSend,
            reason: 'Direct command from Ahmad'
          });
          return {
            action: 'ADMIN_REPLY',
            replyToAhmad: `أبشر أستاذ أحمد، من عيوني! بعثت الرسالة فوراً للرقم (${targetRawPhone}):
"${msgToSend}" 👍`
          };
        } catch (e) {
          return {
            action: 'ADMIN_REPLY',
            replyToAhmad: `أستاذ أحمد، حاولت أبعث للرقم (${targetRawPhone}) بس طلع خطأ: ${e.message}`
          };
        }
      }
    }

    // 3. Question About History / Past Discussions ("شو حكالي فلان؟", "شو صار مع خالد بخصوص العقد؟")
    const isHistoryQuery = /(?:شو حكالي|شو حكى|شو صار مع|وين وصلنا مع|شو كان آخر|آخر رسالة من|شو اتفقنا مع|بخصوص العقد|بخصوص الفلوس|بخصوص المشروع)/iu.test(cleanText);
    if (isHistoryQuery) {
      // Find person mentioned in text
      const words = cleanText.split(/\s+/);
      let person = null;
      for (const w of words) {
        if (w.length >= 3) {
          person = await identityResolver.resolve(w);
          if (person && person.phone && person.phone !== authentication.getOwnerPhone()) break;
        }
      }

      if (person) {
        const dossier = await profileService.getFullDossier(person.phone);
        const historySearch = conversationRetrieval.searchConversationHistory({
          phone: person.phone,
          query: cleanText,
          limit: 6
        });

        let excerpt = '';
        if (historySearch.length > 0) {
          excerpt = historySearch.map(m => `[${m.direction === 'incoming' ? person.name : 'نور/أحمد'}]: ${m.text}`).join('\n');
        } else if (dossier.recentMessages.length > 0) {
          excerpt = dossier.recentMessages.map(m => `[${m.direction === 'incoming' ? person.name : 'نور/أحمد'}]: ${m.text}`).join('\n');
        }

        const systemPrompt = `
أنتِ "نور"، السكرتيرة التنفيذية الذكية للأستاذ أحمد العامودي.
يسألك الأستاذ أحمد سؤالاً عن تاريخ ومحادثات سابقة مع شخص.
بيانات الشخص: ${person.name} (${person.aliases.join(', ')}) - الهاتف: ${person.phone} - العلاقة: ${person.relationship}
الذاكرة المسجلة: ${JSON.stringify(dossier.memories)}
مقتطف من المحادثات السابقة:
${excerpt || 'لا توجد رسائل محددة بالكلمات المطلوبة'}

القواعد:
1. أجيبي باختصار ودقة وذكاء، واذكري آخر موقف واضح ومؤكد.
2. لا تخترعي أي معلومات غير مسجلة. إذا لم تجدي شيئاً محدداً، قولي: "ما لقيت عندي تفاصيل واضحة عن هذا الموضوع بالرسائل الأخيرة".
3. تحدثي بلهجة أردنية عفوية، مهذبة وراقية جداً ("يا هلا أستاذ أحمد", "آخر وضع عنده...").
`;

        const reply = await this.callGemini(apiKey, systemPrompt, cleanText);
        if (reply) {
          return { action: 'ADMIN_REPLY', replyToAhmad: reply };
        }
      }
    }

    // 4. Autonomous Task Coordination ("احكي مع خالد بخصوص العشا / الاجتماع", "رتبيلي موعد مع أبو وليد")
    const isTaskIntent = /(?:احكي مع|شوفي|شوفيلي|شوفلي|رتبلي|رتبيلي|اتواصلي مع|تنسيق|عشا|اجتماع|موعد)/iu.test(cleanText);
    if (isTaskIntent) {
      // Resolve target person
      const words = cleanText.split(/\s+/);
      let targetPerson = null;

      for (let i = 0; i < words.length; i++) {
        const phrase = words.slice(i, i + 3).join(' ');
        const resolved = await identityResolver.resolve(phrase);
        if (resolved && resolved.phone && resolved.phone !== authentication.getOwnerPhone()) {
          targetPerson = resolved;
          break;
        }
      }

      if (targetPerson) {
        let intentType = 'general';
        const lower = cleanText.toLowerCase();
        if (lower.includes('عشا') || lower.includes('غدا') || lower.includes('أكل') || lower.includes('مطعم')) {
          intentType = 'dinner_invite';
        } else if (lower.includes('اجتماع') || lower.includes('موعد') || lower.includes('لقاء') || lower.includes('جلسة')) {
          intentType = 'meeting_request';
        }

        const taskResult = await taskEngine.startTask({
          instruction: cleanText,
          targetPerson,
          intentType,
          ownerPhone: authentication.getOwnerPhone()
        });

        return {
          action: 'ADMIN_REPLY',
          replyToAhmad: taskResult.confirmToAhmad
        };
      }
    }

    // 5. Query about a Phone Number ("هذا الرقم 079... لمين؟")
    const phoneExtract = cleanText.match(/(?:07[789]\d{7}|9627[789]\d{7}|\+9627[789]\d{7})/);
    if (phoneExtract) {
      const resolved = await identityResolver.resolve(phoneExtract[0]);
      if (resolved && resolved.name && !resolved.isAmbiguous) {
        const dossier = await profileService.getFullDossier(resolved.phone);
        const lastMsg = dossier.recentMessages[dossier.recentMessages.length - 1]?.text || 'لا يوجد';
        return {
          action: 'ADMIN_REPLY',
          replyToAhmad: `أستاذ أحمد، هذا الرقم مسجل باسم (${resolved.name})` + (resolved.aliases.length > 0 ? ` والمعروف أيضاً بـ (${resolved.aliases.join('، ')})` : '') + `.
العلاقة: ${resolved.relationship}
آخر تواصل معه كان: "${lastMsg.slice(0, 50)}"`
        };
      } else {
        return {
          action: 'ADMIN_REPLY',
          replyToAhmad: `أستاذ أحمد، شيكت على الرقم (${phoneExtract[0]}) وما لقيت هوية مؤكدة مسجلة إله بالنظام. بدك أحفظه باسم معين عندك؟`
        };
      }
    }

    // 6. Deep Executive AI Brain with Gemini 3.5 Flash
    if (apiKey) {
      try {
        const identities = dbService.getAllIdentities();
        const crmSummary = identities.map(i => `${i.canonical_name} (${i.phone}) - ${i.relationship_type}`).join(' | ');
        const activeTasks = dbService.getAllLifecycleTasks('WAITING_FOR_REPLY');
        const upcomingEvents = dbService.getCalendarEvents({ status: 'scheduled', limit: 5 });

        const executivePrompt = `
أنتِ "نور"، السكرتيرة التنفيذية والمساعدة الشخصية المخلصة والذكية جداً للأستاذ أحمد العامودي.
تتحدثين بلهجة أردنية عفوية، لبقة، راقية ومحترمة (يا هلا والله أستاذ أحمد، أبشر، تكرم عينك، من عيوني، ولا يهمك، شو في ببالك ننجز اليوم).
معلومات المكتب الحالية:
- شبكة العلاقات والـ CRM: [${crmSummary}].
- المهام الجارية بانتظار الرد: ${activeTasks.length}.
- المواعيد القادمة بالتقويم: ${upcomingEvents.length}.

إذا سألك أحمد أي سؤال (استشارة، فكرة، ترتيب، رأي، أسعار، سند تاكسي):
- أجيبي بذكاء وفهم عميق وواقعي.
- كوني مباشرة ولا تطيلي بلا داعٍ.
- ممنوع أي قوالب جامدة أو زخارف مثل ━━━━.
`;

        const reply = await this.callGemini(apiKey, executivePrompt, cleanText);
        if (reply) {
          return { action: 'ADMIN_REPLY', replyToAhmad: reply };
        }
      } catch (e) {
        console.warn('Gemini Executive Error:', e.message);
      }
    }

    // Fallback
    return {
      action: 'ADMIN_REPLY',
      replyToAhmad: `أبشر أستاذ أحمد، أنا معك وجاهزة لكل أوامرك 🌸 شو بتحب نعمل أو نرتب هسا؟`
    };
  }

  /**
   * Handler for External Clients & Visitors
   */
  async handleExternalClient(fromPhone, senderName, cleanText, apiKey) {
    const history = dbService.getRecentContext(fromPhone, 6);
    const resolved = await identityResolver.resolve(fromPhone);
    const displayName = resolved?.name || senderName || '';

    console.log(`👤 [External Dialogue] ${fromPhone} (${displayName}): "${cleanText}"`);

    if (apiKey) {
      try {
        const historyText = history.map(h => `${h.direction === 'incoming' ? 'العميل' : 'نور السكرتيرة'}: ${h.text}`).join('\n');

        const systemPrompt = `
أنتِ "نور"، سكرتيرة ومساعدة مكتب الأستاذ أحمد العامودي (نظام سند تاكسي وخدمات النقل والأعمال).
أسلوبك: إنساني وودود ومحترم جداً، بلهجة أردنية لطيفة وطبيعية (يا هلا والله، أهلاً بحضرتك، تكرم، يسعد أوقاتك).
ممنوعات قطعية:
1. ممنوع نهائياً ذكر كلمة "تذكرة" أو "تكت" إلا إذا العميل طلب صراحة شكوى رسمية أو رفع تذكرة.
2. ممنوع كشف أي معلومات خاصة بالأستاذ أحمد أو أرقامه الشخصية أو ملاحظاته الداخلية.
3. إذا سأل العميل عن الخدمات أو التاكسي أو الأسعار، اشرحي له بوضوح وأدب.

إذا كان العميل يطلب متابعة شخصية رسمية ومباشرة من الأستاذ أحمد:
- ضعي "notifyAdmin": true
- ولخصي السبب في "summary"
غير ذلك: "notifyAdmin": false

الصيغة المطلوبة JSON فقط:
{
  "reply": "نص الرد الطبيعي المباشر للعميل باللهجة الأردنية",
  "notifyAdmin": boolean,
  "summary": "ملخص السبب إن وجد"
}
`;

        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`,
          {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: `محادثة سابقة:
${historyText}

رسالة العميل:
"${cleanText}"` }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.7 }
          },
          { timeout: 8000 }
        );

        const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (raw) {
          const parsed = JSON.parse(raw);
          let adminNotification = null;

          if (parsed.notifyAdmin) {
            const ticket = dbService.createTicket(
              fromPhone,
              displayName || fromPhone,
              parsed.summary || cleanText.slice(0, 50),
              cleanText
            );
            adminNotification = `أستاذ أحمد، وصل استفسار مهم من ${displayName || fromPhone} (+${fromPhone}):
"${cleanText}"
تذكرة: [#${ticket.ticket_number}]. للرد عليه اكتب: #${ticket.ticket_number} [ردك]`;
          }

          return {
            replyToCustomer: parsed.reply,
            adminNotification
          };
        }
      } catch (e) {
        console.warn('Gemini Client Error:', e.message);
      }
    }

    return {
      replyToCustomer: `يا هلا بحضرتك 🌸 استلمت رسالتك. تفضل كيف بقدر أساعدك وأخدمك اليوم في مكتب الأستاذ أحمد؟`
    };
  }

  async callGemini(apiKey, systemInstruction, userText) {
    const models = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
    for (const m of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
        const res = await axios.post(url, {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: userText }] }],
          generationConfig: { temperature: 0.7 }
        }, { timeout: 8000 });

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      } catch (e) {
        console.warn(`⚠️ Gemini model ${m} failed:`, e.message);
      }
    }
    return null;
  }
}

module.exports = new AgentLoop();
