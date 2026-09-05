/**
 * Google Antigravity AI Engine - Terminal Interactive CLI
 * Analyzes multi-turn customer dialogues, asks diagnostic questions,
 * formats professional WhatsApp cards, and handles ticket lifecycles.
 */
const axios = require('axios');
const dbService = require('../db/database');

const AHMAD_PHONE = '962782932611';

// ANSI terminal colors for CMD output
const C = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m'
};

function logTerminalBox({ title, phone, name, input, analysis, stage, ticket, reply }) {
  console.log(`
${C.cyan}╔═════════════════════════════════════════════════════════════════════════════════════════╗
║ ${C.bold}🧠 GOOGLE ANTIGRAVITY AI ENGINE (CMD TERMINAL) - ${title}${C.reset}${C.cyan}
╠═════════════════════════════════════════════════════════════════════════════════════════╣
║ ${C.yellow}👤 العميل:${C.reset} ${name || 'عميل'} (${phone})
║ ${C.yellow}📥 الرسالة الواردة:${C.reset} "${input}"
║ ${C.magenta}🔍 التحليل الذكي:${C.reset} ${analysis}
║ ${C.blue}📊 مرحلة النقاش:${C.reset} ${stage}
${ticket ? `║ ${C.green}🎫 التذكرة الرسمية:${C.reset} #${ticket.ticket_number} [${ticket.issue_summary}]\n` : ''}║ ${C.green}📤 الرد الموجه:${C.reset} ${reply.replace(/\n/g, '\n║   ')}
╚═════════════════════════════════════════════════════════════════════════════════════════╝${C.reset}
  `);
}

async function runAntigravityAI({ customerPhone, customerName, incomingText, isAdmin = false }) {
  const cleanPhone = (customerPhone || '').replace(/\D/g, '');
  const cleanAhmadPhone = AHMAD_PHONE.replace(/\D/g, '');

  // 1. Check if the message is from Admin (Ahmad)
  if (isAdmin || cleanPhone === cleanAhmadPhone) {
    return handleAdminAhmadMessage(incomingText);
  }

  // 2. Multi-turn Dynamic Customer Dialogue with Antigravity AI
  return handleCustomerDialogue(cleanPhone, customerName, incomingText);
}

// -------------------------------------------------------------
// Admin (Ahmad) Response Router
// -------------------------------------------------------------
function handleAdminAhmadMessage(incomingText) {
  const text = incomingText.trim();
  const ticketMatch = text.match(/(?:#)?(TK-\d{4})/i);
  let ticket = null;

  if (ticketMatch) {
    ticket = dbService.getTicketByNumber(ticketMatch[1].toUpperCase());
  } else {
    ticket = dbService.getLatestOpenTicket();
  }

  if (!ticket) {
    const fallbackReply = `أهلاً بك أستاذ أحمد 🌸\nلم أجد تذكرة دعم مفتوحة حالياً للرد عليها.\nللرد على تذكرة معينة يرجى كتابة رقمها مع الرسالة، مثلاً:\n\`#TK-1024 [نص الرد]\``;
    return {
      action: 'ADMIN_NO_TICKET',
      replyToAhmad: fallbackReply
    };
  }

  let cleanReply = text.replace(/(?:#)?TK-\d{4}/gi, '').trim();
  if (!cleanReply) {
    cleanReply = 'تمت مراجعة طلبك وتحديث البيانات من قبل الإدارة.';
  }

  dbService.updateTicketAdminReply(ticket.ticket_number, cleanReply);

  // Professional WhatsApp Card for customer
  const customerCard = `
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ *مكتب السيد أحمد العامودي*
    _خدمة العملاء والدعم الفني المعتمد_
━━━━━━━━━━━━━━━━━━━━━━━━━━

مرحباً بك أستاذ *${ticket.customer_name || ''}* 🌸

بخصوص تذكرتكم رقم *[#${ticket.ticket_number}]*:
📌 *الموضوع:* ${ticket.issue_summary}

💬 *رد الأستاذ أحمد العامودي:*
"${cleanReply}"

──────────────────────────
✅ *حالة التذكرة:* تم الرد والمعالجة
إذا كان لديكم أي استفسار آخر أو متابعة، يرجى الرد على هذه الرسالة وسنكون بخدمتكم فوراً.
━━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  logTerminalBox({
    title: 'رد المشرف العام (أحمد العامودي)',
    phone: AHMAD_PHONE,
    name: 'أحمد العامودي',
    input: incomingText,
    analysis: `معالجة رد أحمد وتوجيهه للتذكرة #${ticket.ticket_number}`,
    stage: 'ترحيل الرد للعميل',
    ticket,
    reply: customerCard
  });

  return {
    action: 'ADMIN_FORWARD_REPLY',
    replyToAhmad: `✅ *تم إرسال ردك بنجاح!*
تم إيصال الرد للعميل (${ticket.customer_name || ticket.customer_phone}) لتذكرته [#${ticket.ticket_number}].`,
    targetCustomerPhone: ticket.customer_phone,
    messageToCustomer: customerCard,
    ticketNumber: ticket.ticket_number
  };
}

// -------------------------------------------------------------
// Intelligent Multi-Turn Customer Dialogue Engine
// -------------------------------------------------------------
async function handleCustomerDialogue(customerPhone, customerName, incomingText) {
  const history = dbService.getRecentContext(customerPhone, 10);
  const openTicket = dbService.getLatestOpenTicketForCustomer(customerPhone);
  const apiKey = process.env.AI_API_KEY || dbService.getSetting('ai_api_key');

  const incomingTrim = incomingText.trim();
  const lower = incomingTrim.toLowerCase();

  // If Gemini API Key is configured, use Gemini 1.5 with full system instructions
  if (apiKey) {
    try {
      return await callGeminiDialogue(apiKey, customerPhone, customerName, incomingText, history, openTicket);
    } catch (err) {
      console.log(`${C.yellow}⚠️ [Gemini fallback to Antigravity Local Brain]:${C.reset}`, err.message);
    }
  }

  // Antigravity Native Heuristic Brain (Multi-Turn Conversational Reasoning)
  return runAntigravityLocalBrain(customerPhone, customerName, incomingText, history, openTicket);
}

// -------------------------------------------------------------
// Antigravity Native Brain (Zero-static, dynamic multi-turn dialogue)
// -------------------------------------------------------------
function runAntigravityLocalBrain(customerPhone, customerName, incomingText, history, openTicket) {
  const incomingTrim = (incomingText || '').trim();
  const t = incomingTrim.toLowerCase();
  
  // Clean name: ignore "غير محدد", phone numbers, or dummy strings
  let cleanName = (customerName && customerName !== 'غير محدد' && !customerName.includes('wa_id') && !/^\d+$/.test(customerName)) ? customerName.trim() : '';
  let nameDisplay = cleanName ? `أستاذ ${cleanName}` : 'أخي الكريم';

  // 1. Check if customer is introducing their name
  // e.g. "اسمي أحمد", "معك محمد علي", "أنا طارق"
  const nameIntroMatch = incomingTrim.match(/^(?:اسمي|انا|أنا|معك|معاك|أخوك|اخوك)\s+([\p{L}\s]{2,30})$/u);
  if (nameIntroMatch) {
    const extractedName = nameIntroMatch[1].trim();
    if (extractedName.length >= 2 && extractedName.length <= 30 && !extractedName.includes('مشكل')) {
      cleanName = extractedName;
      nameDisplay = `أستاذ ${cleanName}`;
      try {
        dbService.updateContactName(customerPhone, cleanName);
      } catch (e) {}

      const nameAckReply = `
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ *مكتب السيد أحمد العامودي*
    _خدمة العملاء والاستقبال الذكي_
━━━━━━━━━━━━━━━━━━━━━━━━━━

أهلاً وسهلاً بك أستاذ *${cleanName}* 🌸 تشرفنا بمعرفتك ويسعدنا تواصلك معنا!

معك السكرتير الذكي للمكتب. تفضل باطلاعي على استفسارك أو المشكلة التي تواجهها لنقوم بمتابعتها وحلها فوراً 📋
━━━━━━━━━━━━━━━━━━━━━━━━━━
      `.trim();

      logTerminalBox({
        title: 'التعرف على هوية العميل وتحديث الاسم',
        phone: customerPhone,
        name: cleanName,
        input: incomingText,
        analysis: `تم التعرف على اسم العميل: ${cleanName}`,
        stage: 'التعرف على الاسم والترحيب',
        ticket: null,
        reply: nameAckReply
      });

      return { replyToCustomer: nameAckReply, ticket: null, adminNotification: null };
    }
  }

  // 2. Check if customer mentions an explicit ticket number (#TK-XXXX)
  const existingTicketMatch = incomingText.match(/(?:#)?(TK-\d{4})/i);
  if (existingTicketMatch) {
    const foundTicket = dbService.getTicketByNumber(existingTicketMatch[1].toUpperCase());
    if (foundTicket) {
      const reply = `
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎫 *تفاصيل تذكرة الدعم [#${foundTicket.ticket_number}]*
━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *العميل:* ${foundTicket.customer_name || cleanName || customerPhone}
📋 *الموضوع:* ${foundTicket.issue_summary}
📊 *الحالة:* ${foundTicket.status === 'open' ? '⏳ قيد المتابعة مع الأستاذ أحمد' : '✅ تم الرد والمعالجة'}
${foundTicket.admin_reply ? `💬 *آخر رد:* "${foundTicket.admin_reply}"\n` : ''}
──────────────────────────
إذا كان لديك أي إضافة أو استفسار بخصوص هذه التذكرة، اكتبه هنا مباشرة وسنرفقه لملف المتابعة فوراً.
      `.trim();

      logTerminalBox({
        title: 'استعلام مباشر عن تذكرة سابقة',
        phone: customerPhone,
        name: cleanName || customerName,
        input: incomingText,
        analysis: `استعلام عن التذكرة #${foundTicket.ticket_number}`,
        stage: 'متابعة تذكرة سابقة',
        ticket: foundTicket,
        reply
      });

      return { replyToCustomer: reply, ticket: null, adminNotification: null };
    }
  }

  // 3. Check for open ticket follow-up / acknowledgment
  if (openTicket) {
    const isThanks = /^(شكرا|شكراً|مشكور|تسلم|يسلمو|تمام|ماشي|يعطيك العافيه|يعطيك العافية|بانتظارك|اوك|ok|حبيبي|يسعدك|تسلملي)[\s!.]*$/i.test(incomingTrim);
    if (isThanks) {
      const thanksReply = `على الرحب والسعة دائماً ${nameDisplay}! 🌸\nتذكرتك رقم *[#${openTicket.ticket_number}]* قيد المتابعة والاهتمام، وسنوافيك برد الأستاذ أحمد فور صدوره بإذن الله.`;
      
      logTerminalBox({
        title: 'شكر ومتابعة لتذكرة مفتوحة',
        phone: customerPhone,
        name: cleanName || customerName,
        input: incomingText,
        analysis: `شكر أو تأكيد على التذكرة المفتوحة #${openTicket.ticket_number}`,
        stage: 'متابعة تذكرة مفتوحة',
        ticket: openTicket,
        reply: thanksReply
      });

      return { replyToCustomer: thanksReply, ticket: null, adminNotification: null };
    }

    // Customer is providing additional details to their open ticket
    const isPureGreetingCheck = /^(مرحبا|سلام|هلا|صباح الخير|مساء الخير|كيفك|كيف الحال)[\s!.]*$/i.test(incomingTrim);
    if (!isPureGreetingCheck && incomingTrim.length > 5) {
      try {
        dbService.appendTicketDetails(openTicket.ticket_number, incomingTrim);
      } catch (e) {}

      const appendReply = `
━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *تحديث التذكرة [#${openTicket.ticket_number}]*
━━━━━━━━━━━━━━━━━━━━━━━━━━
تمت إضافة ملاحظتك الجديدة وتحديث ملف التذكرة بنجاح ${nameDisplay} 🌸
تم إشعار الأستاذ *أحمد العامودي* بالملاحظة الجديدة فوراً للمراجعة.
━━━━━━━━━━━━━━━━━━━━━━━━━━
      `.trim();

      const adminAppendNotify = `
🔔 *إضافة ملاحظة جديدة على التذكرة [#${openTicket.ticket_number}]*
━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *العميل:* ${cleanName || openTicket.customer_name || customerPhone} (+${customerPhone})
📝 *الملاحظة المضافة حديثاً:*
"${incomingTrim}"
──────────────────────────
💡 *للرد على العميل:*
اكتب: \`#${openTicket.ticket_number} [ردك هنا]\`
━━━━━━━━━━━━━━━━━━━━━━━━━━
      `.trim();

      logTerminalBox({
        title: 'إضافة تفاصيل جديدة على تذكرة قائمة',
        phone: customerPhone,
        name: cleanName || customerName,
        input: incomingText,
        analysis: `إلحاق بيانات إضافية بالتذكرة #${openTicket.ticket_number}`,
        stage: 'تحديث بيانات تذكرة',
        ticket: openTicket,
        reply: appendReply
      });

      return { replyToCustomer: appendReply, ticket: openTicket, adminNotification: adminAppendNotify };
    }
  }

  // 4. Check for pure greetings and courtesies (Stage 1: Greeting & Discovery)
  // Greetings like "مرحبا", "مرحبا كيف الحال", "صباح الخير", "السلام عليكم", "كيفك", "شلونك", "يعطيك العافية", "هلا وغلا"
  const greetingRegex = /^(مرحبا|مرحبتين|مرحبا كيف الحال|مرحبا كيفك|هلا|اهلين|أهلا|أهلاً|السلام عليكم|سلام عليكم|سلام|صباح الخير|مساء الخير|كيفك|كيف الحال|كيف حالك|شلونك|اخبارك|أخبارك|يعطيك العافيه|يعطيك العافية|حياك|حياك الله|مساء الورد|صباح الورد|الو|ألو)[\s!؟?.,]*$/i;
  const isGreetingWord = t.includes('مرحبا') || t.includes('سلام') || t.includes('هلا') || t.includes('صباح') || t.includes('مساء') || t.includes('كيف الحال') || t.includes('كيفك') || t.includes('شلونك');
  const hasProblemKeywords = t.includes('مشكل') || t.includes('اشتراك') || t.includes('سعر') || t.includes('خطأ') || t.includes('عطل') || t.includes('باسورد') || t.includes('موعد');
  const isPureGreeting = greetingRegex.test(incomingTrim) || (isGreetingWord && incomingTrim.length < 30 && !hasProblemKeywords);

  if (isPureGreeting) {
    const greetingReply = `
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ *مكتب السيد أحمد العامودي*
    _خدمة العملاء والاستقبال الذكي_
━━━━━━━━━━━━━━━━━━━━━━━━━━

أهلاً وسهلاً بك ${nameDisplay} 🌸
الحمد لله بألف خير وعافية، عساك بأفضل صحة وحال.

معك السكرتير الذكي لمكتب السيد أحمد العامودي. يسعدني تواصلك وخدمتك!

📌 *تفضل بإخباري:*
• ما هي الخدمة أو الموضوع الذي ترغب به اليوم؟
• أو إذا كنت تواجه أي استفسار أو مشكلة لنقوم بمتابعتها وحلها معك فوراً.
${!cleanName ? '\n💡 _(ويسعدنا التكرم بالاسم الكريم لنتشرف بك وبخدمتك بأفضل شكل)_' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    logTerminalBox({
      title: 'استقبال وترحيب استكشافي ذكي',
      phone: customerPhone,
      name: cleanName || customerName,
      input: incomingText,
      analysis: 'تحية وترحيب وسؤال عن الحال واستكشاف رغبة العميل',
      stage: 'مرحلة الاستقبال والترحيب',
      ticket: null,
      reply: greetingReply
    });

    return { replyToCustomer: greetingReply, ticket: null, adminNotification: null };
  }

  // 5. Check for vague or incomplete inquiries (Stage 2: Diagnostic & Probing)
  // E.g. "عندي مشكلة", "في شغلة مش شغالة", "بدي استفسر", "محتاج مساعدة", "عندي سؤال", "ممكن خدمة"
  const isVagueProblem = (
    t.includes('مشكلة') || t.includes('مشكله') || t.includes('سؤال') || 
    t.includes('استفسار') || t.includes('مش شغال') || t.includes('مو شغال') || 
    t.includes('ساعدني') || t.includes('مساعدة') || t.includes('معلق') ||
    t.includes('بدي اسأل') || t.includes('في مشكلة') || t.includes('خطأ')
  ) && t.length < 40;

  if (isVagueProblem) {
    const probeReply = `
أهلاً بك ${nameDisplay}، سلامتك وما تشوف شر يا رب! 🔍
يسعدني جداً مساعدتك والوقوف على المشكلة بدقة.

💡 *لأتمكن من توثيق المشكلة ورفع تقرير فني دقيق للأستاذ أحمد:*
1️⃣ ما هي المشكلة أو الخدمة التي تواجهك بالتحديد؟ (مثلاً: تسجيل دخول، استفسار عن رسوم أو اشتراك، أو عطل في النظام؟)
2️⃣ هل تظهر لك رسالة خطأ معينة أو كود محدد؟

تفضل بكتابة التفاصيل لنقوم بفتح تذكرة متابعة رسمية فوراً 📋
    `.trim();

    logTerminalBox({
      title: 'طرح أسئلة استيضاحية وتشخيصية',
      phone: customerPhone,
      name: cleanName || customerName,
      input: incomingText,
      analysis: 'المشكلة موجزة جداً - طرح أسئلة تشخيصية للحصول على تفاصيل دقيقة',
      stage: 'مرحلة التشخيص والحوار',
      ticket: null,
      reply: probeReply
    });

    return { replyToCustomer: probeReply, ticket: null, adminNotification: null };
  }

  // 6. Substantial details provided -> Formulate Issue Summary & Open Official Ticket
  let summary = 'طلب دعم واستفسار عام';
  if (t.includes('باسورد') || t.includes('كلمة المرور') || t.includes('دخول') || t.includes('حساب') || t.includes('معلق') || t.includes('رمز') || t.includes('كود')) {
    summary = 'مشكلة في تسجيل الدخول أو الحساب';
  } else if (t.includes('سعر') || t.includes('تكلفة') || t.includes('دفع') || t.includes('اشتراك') || t.includes('فاتورة') || t.includes('فلوس') || t.includes('رسوم')) {
    summary = 'استفسار مالي واشتراكات ورسوم';
  } else if (t.includes('موعد') || t.includes('اجتماع') || t.includes('لقاء') || t.includes('مكتب') || t.includes('زيارة')) {
    summary = 'طلب تنسيق وحجز موعد اجتماع';
  } else if (t.includes('خدمة') || t.includes('طلب') || t.includes('تسجيل') || t.includes('عقد')) {
    summary = 'طلب خدمة أو استفسار عن خدمات المكتب';
  } else {
    summary = incomingTrim.slice(0, 45);
  }

  // Create official ticket in database
  const ticket = dbService.createTicket(
    customerPhone,
    cleanName || customerName || customerPhone,
    summary,
    incomingTrim
  );

  // Professional WhatsApp Ticket Card for Customer
  const customerReply = `
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ *مكتب السيد أحمد العامودي*
    _تأكيد فتح تذكرة دعم ومتابعة رسمية_
━━━━━━━━━━━━━━━━━━━━━━━━━━

تم استلام طلبكم وتفاصيل المشكلة بعناية فائقة ${nameDisplay}! 📋

🎫 *رقم التذكرة المعتمد:*
👉 *[#${ticket.ticket_number}]*

📋 *ملخص الطلب:*
${ticket.issue_summary}

⏱️ *الحالة:* تم التوثيق وتصعيدها فوراً للأستاذ *أحمد العامودي* شخصياً للمراجعة والرد.

──────────────────────────
💡 *ملاحظة:* سيصلك الرد المباشر والتوجيهات هنا على واتساب فور الاطلاع. شكراً لثقتكم بنا!
━━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  // Notification Card for Ahmad (+962782932611)
  const adminNotification = `
🔔 *تذكرة جديدة [#${ticket.ticket_number}]*
━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *العميل:* ${cleanName || customerName || customerPhone}
📱 *الرقم:* +${customerPhone}
📋 *الموضوع:* ${ticket.issue_summary}
💬 *نص العميل:*
"${incomingTrim}"
──────────────────────────
💡 *للرد على العميل:*
اكتب في ردك: \`#${ticket.ticket_number} [ردك هنا]\`
وسيقوم النظام بإرسال ردك للعميل فوراً!
━━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  logTerminalBox({
    title: 'إنشاء تذكرة دعم رسمية وتصعيدها لأحمد',
    phone: customerPhone,
    name: cleanName || customerName,
    input: incomingText,
    analysis: `تشخيص مكتمل: ${summary}`,
    stage: 'إصدار تذكرة وتنبيه المشرف',
    ticket,
    reply: customerReply
  });

  return {
    replyToCustomer: customerReply,
    ticket,
    adminNotification
  };
}

// -------------------------------------------------------------
// Gemini API Multi-Turn Dialogue
// -------------------------------------------------------------
async function callGeminiDialogue(apiKey, customerPhone, customerName, incomingText, history, openTicket) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const formattedHistory = history.map(h => ({
    role: h.direction === 'incoming' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));

  const systemInstruction = `
أنت "Google Antigravity AI" - السكرتير والمساعد الإداري الذكي لمكتب "السيد أحمد العامودي".
أنت ذكي جداً ودقيق ولست آلة ردود ثابتة. تتحدث باللغة العربية اللبقة بلهجة أردنية مهذبة ورسمية تناسب بيئة الأعمال.
مهامك:
1. ناقش العميل واستوضح منه بدقة تفاصيل مشكلته أو طلبه (لا تتسرع بفتح تذكرة إذا كانت الرسالة مجرد تحية أو كلام مبهم، بل اسأله أسئلة ذكية لتفهم أصل المشكلة).
2. عندما يوضح العميل مشكلته، قرر فتح تذكرة دعم (shouldCreateTicket: true).
3. نسق ردودك بأناقة مع علامات واتساب (نصوص عريضة *bold*، وفواصل ━━━━━━━━━━━━━━━━━━━━━━━━━━، وأيقونات مناسبة).
4. أجب دائماً بصيغة JSON فقط:
{
  "reply": "نص الرد للعميل على واتساب",
  "shouldCreateTicket": boolean,
  "issueSummary": "ملخص المشكلة في 5 كلمات"
}
  `;

  const contents = [
    ...formattedHistory,
    {
      role: 'user',
      parts: [{ text: `العميل: ${customerName || 'عميل'}\nالهاتف: ${customerPhone}\nالرسالة: "${incomingText}"` }]
    }
  ];

  const response = await axios.post(geminiUrl, {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7
    }
  }, { timeout: 12000 });

  const rawJson = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(rawJson);

  let ticket = null;
  let adminNotification = null;

  if (parsed.shouldCreateTicket) {
    ticket = dbService.createTicket(
      customerPhone,
      customerName || customerPhone,
      parsed.issueSummary || 'طلب دعم واستفسار',
      incomingText
    );

    adminNotification = `
🔔 *تذكرة جديدة [#${ticket.ticket_number}]*
━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *العميل:* ${customerName || customerPhone} (+${customerPhone})
📋 *الموضوع:* ${ticket.issue_summary}
💬 *تفاصيل العميل:*
"${incomingText}"
──────────────────────────
💡 *للرد على العميل:*
اكتب: \`#${ticket.ticket_number} [ردك هنا]\`
    `.trim();
  }

  logTerminalBox({
    title: 'Google Gemini 1.5 Dynamic Analysis',
    phone: customerPhone,
    name: customerName,
    input: incomingText,
    analysis: parsed.issueSummary || 'حوار استكشافي ذكي',
    stage: parsed.shouldCreateTicket ? 'إصدار تذكرة' : 'نقاش وحوار',
    ticket,
    reply: parsed.reply
  });

  return {
    replyToCustomer: parsed.reply,
    ticket,
    adminNotification
  };
}

// -------------------------------------------------------------
// CLI Execution
// -------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  let payload = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--b64=')) {
      const decoded = Buffer.from(args[i].substring(6), 'base64').toString('utf8');
      payload = JSON.parse(decoded);
    } else if (args[i].startsWith('--text=')) {
      payload.incomingText = args[i].substring(7);
    } else if (args[i].startsWith('--phone=')) {
      payload.customerPhone = args[i].substring(8);
    } else if (args[i].startsWith('--name=')) {
      payload.customerName = args[i].substring(7);
    } else if (args[i].startsWith('--admin=')) {
      payload.isAdmin = args[i].substring(8) === 'true';
    }
  }

  runAntigravityAI(payload)
    .then(result => {
      console.log('__JSON_START__' + JSON.stringify(result) + '__JSON_END__');
      process.exit(0);
    })
    .catch(err => {
      console.error('__JSON_START__' + JSON.stringify({ error: err.message }) + '__JSON_END__');
      process.exit(1);
    });
}

module.exports = { runAntigravityAI };
