
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

    // Case B: Check if fromPhone is replying to an active task (Restaurant, Client, Vendor)
    const activeTask = dbService.getActiveLifecycleTaskForPhone(fromPhone);
    if (activeTask && auth.role !== 'OWNER') {
      console.log(`🎯 [Active Task Reply] Phone ${fromPhone} replying to task ${activeTask.task_code}: "${cleanText}"`);
      const taskResult = await taskEngine.handleTargetReply(activeTask, cleanText, fromPhone, apiKey);
      return {
        action: 'TASK_REPLY_HANDLED',
        replyToCustomer: taskResult.replyToCustomer,
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

  extractPhones(text) {
    if (!text) return [];
    const clean = text.replace(/[\u200E\u200F\u202A-\u202E\u00A0\u200B-\u200D\uFEFF]/g, ' ');
    const candidates = clean.match(/(?:\+?962[\s\-]*(?:7[789]|6)[\s\-]*\d{3}[\s\-]*\d{4}|07[789][\s\-]*\d{3}[\s\-]*\d{4}|\+?[0-9\s\-]{9,18})/g) || [];
    const normalized = [];
    for (const c of candidates) {
      const digits = c.replace(/\D/g, '');
      if (digits.length >= 9 && digits.length <= 15) {
        let p = digits;
        if (p.startsWith('00')) p = p.slice(2);
        if (p.startsWith('07') && p.length === 10) p = '962' + p.slice(1);
        else if (p.startsWith('7') && p.length === 9) p = '962' + p;
        normalized.push(p);
      }
    }
    return [...new Set(normalized)];
  }

  /**
   * Executive Handler for Ahmad Alamoudi
   */
  async handleOwnerInstruction(cleanText, apiKey) {
    console.log(`👑 [Executive Agent Loop] Ahmad: "${cleanText}"`);

    // 0. Check if Ahmad is answering a pending decision/consultation for an active task
    const pendingTask = dbService.getActiveTaskAwaitingOwnerDecision();
    if (pendingTask) {
      console.log(`👑 [Ahmad Decision] Answering pending task ${pendingTask.task_code}: "${cleanText}"`);
      const decisionResult = await taskEngine.handleAhmadDecisionForTask(pendingTask, cleanText, apiKey);
      return {
        action: 'ADMIN_REPLY',
        replyToAhmad: decisionResult.confirmToAhmad
      };
    }

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

    // 2. Everything else goes through the agentic tool-calling loop: Nour
    // decides which registered tool(s) to call (send WhatsApp messages,
    // start orders, save facts, manage tasks/calendar, look people up)
    // instead of being limited to a fixed list of anticipated phrasings.
    const reply = await this.runAgenticToolLoop({ cleanText, apiKey });
    return { action: 'ADMIN_REPLY', replyToAhmad: reply };
  }

  /**
   * Converts the tool registry's declarations into Gemini's function-calling format.
   */
  buildGeminiTools() {
    const declarations = toolRegistry.getToolDeclarations();
    return [{ functionDeclarations: declarations }];
  }

  /**
   * Same model-fallback pattern as callGemini/callGeminiJson, but attaches
   * tool declarations and returns the raw candidate content so the caller
   * can inspect functionCall parts vs plain text parts.
   */
  async callGeminiWithTools(apiKey, systemInstruction, contents, tools) {
    const models = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
    for (const m of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
        const res = await axios.post(url, {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          tools,
          generationConfig: { temperature: 0.4 }
        }, { timeout: 20000 });

        const candidate = res.data?.candidates?.[0];
        if (candidate?.content) return candidate.content;
      } catch (e) {
        console.warn(`⚠️ Gemini tool-call model ${m} failed:`, e.response?.data?.error?.message || e.message);
      }
    }
    return null;
  }

  /**
   * The core agentic reasoning loop for Ahmad's instructions: Nour is given
   * full context plus the entire tool registry, and iteratively decides
   * which tools to call (if any) until she produces a final text reply.
   */
  async runAgenticToolLoop({ cleanText, apiKey }) {
    if (!apiKey) {
      return `أبشر أستاذ أحمد، أنا معك وجاهزة لكل أوامرك 🌸 بس ما في مفتاح API مفعّل حالياً حتى أقدر أفكر وأنفذ طلبك بذكاء.`;
    }

    const identities = dbService.getAllIdentities();
    const vipNetworkSummary = identities.map(i => `${i.canonical_name} (${i.primary_alias || ''}) [${i.phone}] - ${i.relationship_type}`).join(' | ');
    const activeTasks = dbService.getAllLifecycleTasks('WAITING_FOR_REPLY');
    const activeTasksSummary = activeTasks.map(t => `${t.task_code}: ${t.goal} (${t.status})`).join('\n') || 'لا توجد مهام جارية بانتظار الرد.';
    const upcomingEvents = dbService.getCalendarEvents({ status: 'scheduled', limit: 5 });
    const memories = dbService.getMemories({ limit: 8 });
    const memoriesSummary = memories.map(m => `- ${m.content}`).join('\n') || 'لا توجد ذكريات إضافية';

    const systemInstruction = `
أنتِ "نور"، السكرتيرة التنفيذية والمساعدة الشخصية المخلصة والذكية جداً للأستاذ أحمد العامودي.
تتحدثين بلهجة أردنية عفوية، لبقة، راقية ومحترمة (يا هلا والله أستاذ أحمد، أبشر، تكرم عينك، من عيوني، ولا يهمك).

معلومات وسياق المكتب والذاكرة الحالية:
- شبكة الأشخاص والـ CRM:
${vipNetworkSummary}

- أهم الذكريات والمعلومات المحفوظة:
${memoriesSummary}

- المهام الجارية بانتظار الرد:
${activeTasksSummary}

- المواعيد القادمة بالتقويم: ${upcomingEvents.length}.

عندك مجموعة أدوات فعلية مسجلة (whatsapp.send، orders.start، tasks.create/update/get/getActiveForPhone،
calendar.check/create، contacts.resolve، crm.update، people.getDossier، people.remember،
tickets.reply، memory.search/storeFact، conversation.search/summarizeTopic).

قواعد أساسية:
1. إذا كان طلب الأستاذ أحمد يتطلب تنفيذ فعلي (إرسال رسالة، طلب أوردر من مطعم، حفظ معلومة، إنشاء موعد،
   تحديث أو الاستعلام عن مهمة، البحث عن شخص أو تاريخ محادثات)، استخدمي الأداة المناسبة فعلياً بدل ما تكتفي
   بالكلام عن تنفيذها.
2. لا تفترضي بيانات ناقصة (رقم هاتف، تفاصيل الطلب) — إذا كانت ناقصة اسأليه عنها مباشرة بدل التخمين.
3. إذا استدعيت أداة وحصل خطأ أو احتاج الأمر موافقة إضافية، اشرحي له الموقف بوضوح وبلا تعقيد.
4. بعد تنفيذ الأدوات اللازمة، لخصي له النتيجة بردة نهائية طبيعية باللهجة الأردنية، بدون أي قوالب جامدة
   أو زخارف مثل ━━━━.
5. إذا كان الطلب مجرد سؤال أو دردشة عادية، أجيبي مباشرة بذكاء وفهم بشري عميق دون الحاجة لأي أداة.
`;

    const contents = [{ role: 'user', parts: [{ text: cleanText }] }];
    const tools = this.buildGeminiTools();
    const maxIterations = 6;

    for (let i = 0; i < maxIterations; i++) {
      const content = await this.callGeminiWithTools(apiKey, systemInstruction, contents, tools);
      if (!content) break;

      const functionCalls = (content.parts || []).filter(p => p.functionCall);
      if (functionCalls.length === 0) {
        const textPart = (content.parts || []).find(p => p.text)?.text;
        if (textPart) return textPart.trim();
        break;
      }

      contents.push({ role: 'model', parts: content.parts });

      const responseParts = [];
      for (const part of functionCalls) {
        const { name, args } = part.functionCall;
        try {
          const result = await toolRegistry.execute(name, args || {}, 'OWNER');

          if (result.status === 'APPROVAL_REQUIRED') {
            return `أستاذ أحمد، قبل ما أنفذ هاد الإجراء (${name}) حابة آخذ موافقتك الصريحة: ${result.reason}`;
          }

          responseParts.push({
            functionResponse: { name, response: { result: result.result } }
          });
        } catch (e) {
          responseParts.push({
            functionResponse: { name, response: { error: e.message } }
          });
        }
      }

      contents.push({ role: 'function', parts: responseParts });
    }

    return `أبشر أستاذ أحمد، أنا معك وجاهزة لكل أوامرك 🌸 شو بتحب نعمل أو نرتب هسا؟`;
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

        const parsed = await this.callGeminiJson(apiKey, systemPrompt, `محادثة سابقة:\n${historyText}\n\nرسالة العميل:\n"${cleanText}"`);
        if (parsed) {
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
        }, { timeout: 15000 });

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      } catch (e) {
        console.warn(`⚠️ Gemini model ${m} failed:`, e.message);
      }
    }
    return null;
  }

  async callGeminiJson(apiKey, systemInstruction, userText) {
    const models = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
    for (const m of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
        const res = await axios.post(url, {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: userText }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
        }, { timeout: 15000 });

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return JSON.parse(text);
      } catch (e) {
        console.warn(`⚠️ Gemini JSON model ${m} failed:`, e.message);
      }
    }
    return null;
  }
}

module.exports = new AgentLoop();
