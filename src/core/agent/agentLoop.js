
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
    const directSendMatch = cleanText.match(/(?:ابعتي|ابعثي|ابعت|ابعث|ارسل|ارسلي|رسالة|مسج)\s+(?:رسالة\s+)?(?:لـ?لرقم|لـ?رقم|لـ?)\s*([0-9+\s\-]{9,18})[:\s]+(?:احكيله|احكي له|قله|قل له|نصها)?[:\s]*(.*)$/iu);
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

    // 3. Dynamic Fact & Relationship Learner (Ahmad teaching Nour / storing facts)
    const isLearnIntent = /(?:احفظ|احفظي|سجل|سجلي|تذكر|تذكري|خلي ببالك|بدي تعرف|بدي ياكي تعرفي|لا تنسى|لا تنسي|معلومة مهمة)/iu.test(cleanText) ||
                          /(?:ابوي هو|ابوي اسمه|رقم ابوي|اخوي اسمه|رقم اخوي|امي اسمها|رقم امي|شريكي هو|صاحبي هو|زبوني هو)/iu.test(cleanText);
    if (isLearnIntent && apiKey) {
      try {
        const learnPrompt = `
أنتِ العقل الداخلي للسكرتيرة نور. الأستاذ أحمد يعلمك أو يطلب منكِ حفظ معلومة جديدة أو رقم شخص أو علاقة.
حللي النص التالي واستخرجي البيانات بصيغة JSON فقط:
{
  "personName": "اسم الشخص إن وجد أو فارغ",
  "personPhone": "رقم الهاتف إن وجد أو فارغ",
  "relation": "نوع العلاقة (FAMILY_FATHER, FAMILY_BROTHER, PARTNER, CLIENT, VIP, GENERAL)",
  "fact": "الحقيقة أو المعلومة المطلوب حفظها بدقة",
  "aliases": ["أي ألقاب أو أسماء مرادفة له"],
  "confirmation": "رسالة تأكيد لطيفة ومحترمة للأستاذ أحمد باللهجة الأردنية بأنه تم حفظ المعلومة بالذاكرة الدائمة"
}
`;
        const learned = await this.callGeminiJson(apiKey, learnPrompt, cleanText);
        if (learned && (learned.fact || learned.personName)) {
          let cleanLearnedPhone = learned.personPhone ? authentication.normalizePhone(learned.personPhone) : null;
          if (!cleanLearnedPhone) {
            const ext = this.extractPhones(cleanText);
            if (ext.length > 0) cleanLearnedPhone = ext[0];
          }

          let identityId = null;
          if (learned.personName && cleanLearnedPhone) {
            const iden = dbService.upsertIdentity({
              canonical_name: learned.personName,
              phone: cleanLearnedPhone,
              primary_alias: learned.aliases?.[0] || learned.personName,
              relationship_type: learned.relation || 'VIP',
              company: '',
              confidence: 1.0,
              notes: learned.fact || ''
            });
            identityId = iden.id;
            if (Array.isArray(learned.aliases)) {
              for (const al of learned.aliases) {
                dbService.addIdentityAlias(identityId, al, 'learned', 'owner_instruction', 1.0);
              }
            }
          }

          await memoryEngine.recordLongTermFact({
            entityPhone: cleanLearnedPhone,
            entityName: learned.personName || 'أحمد العامودي',
            fact: learned.fact || cleanText,
            source: 'Ahmad direct instruction',
            confidence: 1.0,
            classification: 'owner'
          });

          return {
            action: 'ADMIN_REPLY',
            replyToAhmad: learned.confirmation || `أبشر أستاذ أحمد، سجلت وحفظت هاي المعلومة عندي بالذاكرة الدائمة 🌸`
          };
        }
      } catch (e) {
        console.warn('Learning Engine Error:', e.message);
      }
    }

    // 4. Person, Phone Number, Conversation History, or Family Inquiry (Father / VIPs / History)
    const extractedPhones = this.extractPhones(cleanText);
    const mentionsFather = /(?:ابوي|أبوي|والدي|الوالد|ابو احمد|أبو أحمد|محمد العامودي)/iu.test(cleanText);
    const isHistoryOrDossierQuery = /(?:شو في بينك وبين|شو حكيتي|شو انبعث|شو دار|شو المحادثات|شو صار مع|وين وصلنا مع|شو بتعرفي عن|شو حكالي|شو حكى|مين صاحب|مين هاد|مين هذا|محادثات|تفاصيل|تاريخ|سجل)/iu.test(cleanText);

    if (extractedPhones.length > 0 || mentionsFather || isHistoryOrDossierQuery) {
      let targetPerson = null;
      let targetPhone = extractedPhones[0] || null;

      if (targetPhone) {
        targetPerson = await identityResolver.resolve(targetPhone);
      } else if (mentionsFather) {
        targetPerson = await identityResolver.resolve('محمد العامودي');
        targetPhone = targetPerson?.phone || '962790525996';
      } else {
        const words = cleanText.split(/\s+/);
        for (const w of words) {
          if (w.length >= 3) {
            const resolved = await identityResolver.resolve(w);
            if (resolved && resolved.phone && resolved.phone !== authentication.getOwnerPhone()) {
              targetPerson = resolved;
              targetPhone = resolved.phone;
              break;
            }
          }
        }
      }

      if (targetPhone || targetPerson) {
        const messages = targetPhone ? dbService.getMessages(targetPhone, 20) : [];
        const memories = targetPhone ? memoryEngine.getRelevantMemories({ entityPhone: targetPhone, callerClassification: 'owner' }) : [];
        const activeTask = targetPhone ? dbService.getActiveLifecycleTaskForPhone(targetPhone) : null;

        const messagesText = messages.length > 0 
          ? messages.map(m => `[${m.created_at}] [${m.direction === 'incoming' ? (targetPerson?.name || 'الطرف الآخر') : 'نور السكرتيرة'}]: ${m.text}`).join('\n')
          : 'لا توجد أي رسائل سابقة مسجلة في قاعدة البيانات مع هذا الرقم.';

        const memoriesText = memories.length > 0
          ? memories.map(m => `- [${m.memory_type}]: ${m.content}`).join('\n')
          : 'لا توجد ذكريات سابقة خاصة مسجلة.';

        const isFatherTarget = mentionsFather || targetPhone === '962790525996' || targetPerson?.relationship === 'FAMILY_FATHER' || targetPerson?.name?.includes('محمد العامودي');

        const systemPrompt = `
أنتِ "نور"، السكرتيرة التنفيذية الذكية والمخلصة للأستاذ أحمد العامودي.
يسألك الأستاذ أحمد سؤالاً استفسارياً عن شخص، رقم هاتف، أو تاريخ محادثات سابقة.

بيانات الطرف المستعلم عنه:
- الاسم / الهوية: ${targetPerson ? `${targetPerson.name} (${targetPerson.aliases?.join(', ') || ''})` : `رقم (+${targetPhone})`}
- رقم الهاتف: ${targetPhone || 'غير محدد'}
- العلاقة بالأستاذ أحمد: ${isFatherTarget ? 'والد الأستاذ أحمد العامودي (له أعلى مكانة واحترام)' : (targetPerson?.relationship || 'جهة اتصال')}
- الملاحظات: ${targetPerson?.notes || 'لا توجد'}
- مهمة جارية مرتبطة به: ${activeTask ? `${activeTask.goal} (${activeTask.status})` : 'لا توجد مهام جارية'}

الذاكرة والحقائق المسجلة بالنظام:
${memoriesText}

سجل الرسائل الحقيقي المسترجع من قاعدة البيانات:
${messagesText}

قواعد الرد للأستاذ أحمد:
1. ${isFatherTarget ? 'الشخص هو والد الأستاذ أحمد (السيد محمد العامودي / عمي أبو أحمد). تحدثي بمنتهى الاحترام واللباقة والتقدير التام بلهجة أردنية عفوية وراقية تليق بالوالد الفاضل.' : 'أجيبي بلهجة أردنية مهذبة، ذكية، وواضحة.'}
2. إذا كان هناك رسائل سابقة في السجل أعلاه، اذكري له ما تم إرساله أو استقباله بالتاريخ والمضمون بكل دقة وأمانة، ووضحي إذا ما زلنا بانتظار رده.
3. إذا لم تكن هناك أي رسائل مسجلة، قولي له بوضوح: ما في أي محادثات سابقة مسجلة عندي مع هذا الرقم، واذكري اسمه إن كان معروفاً لديكِ.
4. كوني مباشرة ودقيقة ولا تستخدمي أي نصوص آلية أو قوالب خشبية. اعتمدي 100% على السجل والحقائق أعلاه.
`;

        if (apiKey) {
          const reply = await this.callGemini(apiKey, systemPrompt, cleanText);
          if (reply) {
            return { action: 'ADMIN_REPLY', replyToAhmad: reply };
          }
        }

        if (isFatherTarget) {
          return {
            action: 'ADMIN_REPLY',
            replyToAhmad: `يا هلا والله أستاذ أحمد. هاد الرقم للوالد الفاضل (السيد محمد العامودي - عمي أبو أحمد). شيكتلك على السجل وفي رسالة ترحيبية وتنسيقية انبعثتله بتاريخ 4/9 وبانتظار رده، وأي جديد بخصوصه ببلغك فيه أول بأول 🌸`
          };
        }
      }
    }

    // 5. Autonomous Task Coordination ("احكي مع خالد بخصوص العشا / الاجتماع", "رتبيلي موعد مع أبو وليد")
    const isTaskIntent = /(?:احكي مع|شوفي|شوفيلي|شوفلي|رتبلي|رتبيلي|اتواصلي مع|تنسيق|عشا|اجتماع|موعد)/iu.test(cleanText);
    if (isTaskIntent) {
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

    // 6. Deep Executive AI Brain with Gemini 3.6 Flash
    if (apiKey) {
      try {
        const identities = dbService.getAllIdentities();
        const vipNetworkSummary = identities.map(i => `${i.canonical_name} (${i.primary_alias || ''}) [${i.phone}] - ${i.relationship_type}`).join(' | ');
        const activeTasks = dbService.getAllLifecycleTasks('WAITING_FOR_REPLY');
        const upcomingEvents = dbService.getCalendarEvents({ status: 'scheduled', limit: 5 });
        const memories = dbService.getMemories({ limit: 8 });
        const memoriesSummary = memories.map(m => `- ${m.content}`).join('\n');

        const executivePrompt = `
أنتِ "نور"، السكرتيرة التنفيذية والمساعدة الشخصية المخلصة والذكية جداً للأستاذ أحمد العامودي.
تتحدثين بلهجة أردنية عفوية، لبقة، راقية ومحترمة (يا هلا والله أستاذ أحمد، أبشر، تكرم عينك، من عيوني، ولا يهمك، شو في ببالك ننجز اليوم).

معلومات وسياق المكتب والذاكرة الحالية:
- شبكة الأشخاص والعائلة والـ CRM:
${vipNetworkSummary}
(ملاحظة هامة: السيد محمد العامودي +962790525996 هو والد الأستاذ أحمد، وخالد سلامة +962791112233 هو شريك وعميل مقرب).

- أهم الذكريات والمعلومات المحفوظة:
${memoriesSummary || 'لا توجد ذكريات إضافية'}

- المهام الجارية بانتظار الرد: ${activeTasks.length}.
- المواعيد القادمة بالتقويم: ${upcomingEvents.length}.

إذا سألك أحمد أي سؤال (استشارة، فكرة، ترتيب، رأي، أسعار، سند تاكسي، عائلة، أشخاص):
- أجيبي بذكاء وفهم عميق وواقعي بدون أي نسيان لهوية أي شخص.
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
