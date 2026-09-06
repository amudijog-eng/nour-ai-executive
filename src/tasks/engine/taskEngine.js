const axios = require('axios');
const dbService = require('../../db/database');
const toolRegistry = require('../../tools/registry');
const memoryEngine = require('../../core/memory/memoryEngine');

class TaskEngine {
  getApiKey() {
    return process.env.AI_API_KEY || dbService.getSetting('ai_api_key') || '';
  }

  async callGeminiJson(apiKey, systemInstruction, userText) {
    const key = apiKey || this.getApiKey();
    const models = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
    for (const m of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
        const res = await axios.post(url, {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: userText }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
        }, { timeout: 15000 });

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return JSON.parse(text);
      } catch (e) {
        console.warn(`⚠️ TaskEngine Gemini JSON model ${m} failed:`, e.message);
      }
    }
    return null;
  }

  /**
   * Start an Autonomous Food Order / Errand Task with a Restaurant or Vendor
   */
  async startOrderTask({ instruction, targetPhone, targetName = 'المطعم', orderDetails, ownerPhone = '962782932611' }) {
    const cleanTargetPhone = String(targetPhone).replace(/\D/g, '');
    const cleanOwnerPhone = String(ownerPhone).replace(/\D/g, '');

    const messageToTarget = `مرحبا يعطيكم ألف عافية 🌸
يتواصل معكم المساعد الشخصي لمكتب الأستاذ أحمد العامودي.
حابين نطلب من عندكم الأوردر التالي لو تكرمتم:
📌 ${orderDetails}

يا ريت تأكدولنا توفر الأصناف، السعر الإجمالي، والوقت المتوقع للتجهيز والتوصيل. شكراً جزيلاً لكم!`;

    const taskCode = `ORDER-${Math.floor(1000 + Math.random() * 9000)}`;
    const goal = `طلب أوردر من ${targetName}: ${orderDetails}`;

    const task = dbService.createLifecycleTask({
      goal,
      owner_phone: cleanOwnerPhone,
      participants: [cleanTargetPhone],
      steps: [
        { name: 'send_order', status: 'COMPLETED' },
        { name: 'await_reply', status: 'WAITING' },
        { name: 'confirm_or_consult', status: 'PENDING' }
      ],
      context: {
        intentType: 'food_order',
        targetName,
        targetPhone: cleanTargetPhone,
        orderDetails,
        initialInstruction: instruction,
        lastMessageToTarget: messageToTarget,
        history: [
          { role: 'nour_to_target', text: messageToTarget, timestamp: new Date().toISOString() }
        ]
      }
    });

    dbService.updateLifecycleTask(task.task_code, {
      status: 'WAITING_FOR_REPLY',
      current_step: 'await_reply',
      historyEvent: {
        event: 'ORDER_DISPATCHED',
        to: cleanTargetPhone,
        text: messageToTarget
      }
    });

    await toolRegistry.execute('whatsapp.send', {
      toPhone: cleanTargetPhone,
      messageText: messageToTarget,
      reason: goal,
      actorPhone: cleanOwnerPhone
    });

    await memoryEngine.recordEpisodicEvent({
      entityPhone: cleanTargetPhone,
      entityName: targetName,
      eventDescription: `بدء طلب أوردر من ${targetName}: "${orderDetails}". تم إرسال الرسالة للمطعم وبانتظار الرد.`,
      source: 'task_engine_order'
    });

    return {
      task,
      confirmToAhmad: `أبشر أستاذ أحمد، من عيوني! تواصلت فوراً مع ${targetName} وبعثتله تفاصيل الأوردر:\n"${orderDetails}"\nوبانتظار تأكيدهم للسعر والوقت، وأي تفصيل أو استفسار برجعلك فيه فوراً 🌸`,
      targetPhone: cleanTargetPhone,
      messageToTarget
    };
  }

  /**
   * Start a Meeting / Dinner Coordination Task
   */
  async startTask({ instruction, targetPerson, intentType = 'general', ownerPhone = '962782932611' }) {
    const targetPhone = targetPerson.phone;
    const targetName = targetPerson.name;
    const targetAlias = targetPerson.aliases?.[0] || targetName;

    let messageToTarget = '';
    let goal = '';

    if (intentType === 'dinner_invite') {
      goal = `تنسيق دعوة عشاء مع ${targetName} (${targetAlias})`;
      messageToTarget = `مرحبا أستاذ ${targetName} (${targetAlias}) 🌸 يسعد مساك يا رب.
يتواصل معك مكتب الأستاذ أحمد العامودي.. الأستاذ أحمد بسأل حضرتك إذا بناسبك تطلعوا اليوم ع العشا مع بعض؟ 🍽️
قولي شو الوقت اللي بكون مناسب إلك؟`;
    } else if (intentType === 'meeting_request') {
      goal = `حجز وتنسيق موعد اجتماع مع ${targetName} (${targetAlias})`;
      messageToTarget = `أهلاً بك أستاذ ${targetName} 🌸 تحياتي لحضرتك من مكتب الأستاذ أحمد العامودي.
الأستاذ أحمد بطلب مني أرتب معكم موعد اجتماع الأسبوع القادم لمناقشة التفاصيل.
يا ريت تبلغني شو الأيام أو الساعات الأنسب لجدولك حتى نثبته.`;
    } else {
      goal = `متابعة مع ${targetName}: ${instruction.slice(0, 50)}`;
      messageToTarget = `مرحبا أستاذ ${targetName} 🌸 يسعد أوقاتك من طرف الأستاذ أحمد العامودي:
${instruction}`;
    }

    const task = dbService.createLifecycleTask({
      goal,
      owner_phone: ownerPhone,
      participants: [targetPhone],
      steps: [
        { name: 'send_invitation', status: 'COMPLETED' },
        { name: 'await_reply', status: 'WAITING' },
        { name: 'negotiate_or_confirm', status: 'PENDING' }
      ],
      context: {
        intentType,
        targetName,
        targetAlias,
        targetPhone,
        initialInstruction: instruction,
        lastMessageToTarget: messageToTarget,
        history: [
          { role: 'nour_to_target', text: messageToTarget, timestamp: new Date().toISOString() }
        ]
      }
    });

    dbService.updateLifecycleTask(task.task_code, {
      status: 'WAITING_FOR_REPLY',
      current_step: 'await_reply',
      historyEvent: {
        event: 'OUTBOUND_MESSAGE_DISPATCHED',
        to: targetPhone,
        text: messageToTarget
      }
    });

    await toolRegistry.execute('whatsapp.send', {
      toPhone: targetPhone,
      messageText: messageToTarget,
      reason: goal,
      actorPhone: ownerPhone
    });

    await memoryEngine.recordEpisodicEvent({
      entityPhone: targetPhone,
      entityName: targetName,
      eventDescription: `بدء مهمة: ${goal}. تم إرسال رسالة التنسيق وبانتظار الرد.`,
      source: 'task_engine'
    });

    return {
      task,
      confirmToAhmad: `أبشر أستاذ أحمد، من عيوني! تواصلت فوراً مع ${targetName} (${targetAlias}) وبانتظار رده لأرتب كل شي وأبلغك بالنتيجة مباشرة 👍`,
      targetPhone,
      messageToTarget
    };
  }

  /**
   * Handle incoming response from third party (Restaurant / Vendor / Contact)
   */
  async handleTargetReply(activeTask, text, fromPhone, apiKey = null) {
    const cleanText = (text || '').trim();
    const taskCode = activeTask.task_code;
    const ctx = activeTask.context || {};
    const targetName = ctx.targetName || 'الطرف الآخر';
    const targetAlias = ctx.targetAlias || targetName;
    const intentType = ctx.intentType || 'general';

    // 1. Food Order / Errand Negotiation Logic
    if (intentType === 'food_order') {
      const orderDetails = ctx.orderDetails || '';
      const orderSystemPrompt = `
أنتِ "نور"، السكرتيرة التنفيذية الذكية والمخلصة للأستاذ أحمد العامودي.
أنتِ حالياً تتابعين طلباً أو أوردر مع مطعم أو جهة خارجية:
- اسم المطعم / المحل: ${targetName} (${fromPhone})
- تفاصيل الطلب المطلوب: ${orderDetails}
- الرسالة المستلمة الآن من المطعم: "${cleanText}"

حللي رد المطعم بدقة شديدة وتصرفي كـ سكرتيرة بشرية ذكية جداً:
1. هل الطلب مؤكد ومتوفر بالكامل (أو تم قبوله وتحديد السعر والوقت) دون أي شروط أو استفسارات معلقة؟
   -> "category": "CONFIRMED"
   -> "replyToRestaurant": رسالة تأكيد وشكر للمطعم باللهجة الأردنية ("يسعدكم، تم بالانتظار ويعطيكم العافية 🌸")
   -> "alertToAhmad": إشعار أحمد بأن المطعم أكد الطلب مع ذكر تفاصيل السعر والوقت.

2. هل رد المطعم يحتاج قراراً أو موافقة من الأستاذ أحمد؟ (مثلاً: صنف غير متوفر وبقترحوا بديل، أو استفسار عن العنوان/الموقع، أو السعر كبير وبدهم تأكيد، أو وقت التوصيل طويل، أو بيسألوا كاش ولا كليك):
   -> "category": "NEEDS_OWNER_DECISION"
   -> "replyToRestaurant": رسالة مهذبة للمطعم تطلب منهم الانتظار لحظة ("ألف شكر، ثواني أشيك مع الأستاذ أحمد وأرجعلك فوراً 👍")
   -> "alertToAhmad": صياغة رسالة عفوية ومباشرة للأستاذ أحمد تشرحين له ما قاله المطعم وتسألينه عن رأيه وقراره بوضوح ("أستاذ أحمد، حكيت مع المطعم وسجلت طلبك، بس حكولي إنه... شو رأيك؟").
   -> "decisionNeeded": ملخص السؤال المطلوب إجابته من أحمد.

3. هل اعتذر المطعم نهائياً ولا يمكن تلبية الطلب؟
   -> "category": "DECLINED"
   -> "replyToRestaurant": "ولا يهمكم، شكراً لكم وبنطلب بوقت ثاني إن شاء الله"
   -> "alertToAhmad": إبلاغ أحمد بأن المطعم اعتذر مع ذكر السبب.

أعيدي JSON فقط:
{
  "category": "CONFIRMED" | "NEEDS_OWNER_DECISION" | "DECLINED",
  "replyToRestaurant": "...",
  "alertToAhmad": "...",
  "decisionNeeded": "...",
  "orderSummary": "..."
}
`;

      const aiEvaluation = await this.callGeminiJson(apiKey, orderSystemPrompt, cleanText);

      if (aiEvaluation) {
        if (aiEvaluation.category === 'NEEDS_OWNER_DECISION') {
          dbService.updateLifecycleTask(taskCode, {
            status: 'WAITING_FOR_AHMAD_DECISION',
            current_step: 'consulting_ahmad',
            context: {
              lastRestaurantReply: cleanText,
              pendingDecision: aiEvaluation.decisionNeeded || cleanText,
              orderSummary: aiEvaluation.orderSummary || ''
            },
            historyEvent: { event: 'ESCALATED_TO_AHMAD', restaurantReply: cleanText, question: aiEvaluation.alertToAhmad }
          });

          if (aiEvaluation.replyToRestaurant) {
            await toolRegistry.execute('whatsapp.send', { toPhone: fromPhone, messageText: aiEvaluation.replyToRestaurant });
          }

          return {
            replyToCustomer: aiEvaluation.replyToRestaurant,
            alertToAhmad: aiEvaluation.alertToAhmad,
            task: activeTask,
            status: 'WAITING_FOR_AHMAD_DECISION'
          };
        } else if (aiEvaluation.category === 'CONFIRMED') {
          dbService.updateLifecycleTask(taskCode, {
            status: 'COMPLETED',
            current_step: 'order_confirmed',
            result_summary: aiEvaluation.orderSummary || cleanText,
            historyEvent: { event: 'ORDER_CONFIRMED', restaurantReply: cleanText }
          });

          if (aiEvaluation.replyToRestaurant) {
            await toolRegistry.execute('whatsapp.send', { toPhone: fromPhone, messageText: aiEvaluation.replyToRestaurant });
          }

          return {
            replyToCustomer: aiEvaluation.replyToRestaurant,
            alertToAhmad: aiEvaluation.alertToAhmad,
            task: activeTask,
            status: 'COMPLETED'
          };
        } else if (aiEvaluation.category === 'DECLINED') {
          dbService.updateLifecycleTask(taskCode, {
            status: 'COMPLETED',
            current_step: 'order_declined',
            result_summary: `اعتذر المطعم: ${cleanText}`,
            historyEvent: { event: 'ORDER_DECLINED', restaurantReply: cleanText }
          });

          if (aiEvaluation.replyToRestaurant) {
            await toolRegistry.execute('whatsapp.send', { toPhone: fromPhone, messageText: aiEvaluation.replyToRestaurant });
          }

          return {
            replyToCustomer: aiEvaluation.replyToRestaurant,
            alertToAhmad: aiEvaluation.alertToAhmad || `أستاذ أحمد، رد المطعم واعتذر عن الطلب قائلاً: "${cleanText}"`,
            task: activeTask,
            status: 'COMPLETED'
          };
        }
      }
    }

    // 2. Default Meeting / Dinner Negotiation Logic
    const lower = cleanText.toLowerCase();
    const hasTime = /(?:الساعة|ساعه|ع\s*الساعة|\b[1-9]|1[0-2]\b|مساء|عصرا|صباحا)/i.test(cleanText);
    const isAccept = /(?:موافق|تمام|ماشي|أكيد|اكيد|بناسبني|جاهز|يسعدك|ان شاء الله|إن شاء الله|هلا والله)/i.test(cleanText);
    const isReject = /(?:اعتذر|بعتذر|مش فاضي|صعب|مشغول|ما بقدر|ما بقدرش|بلاش اليوم|خليه وقت ثاني)/i.test(cleanText);

    if (isReject) {
      dbService.updateLifecycleTask(taskCode, {
        status: 'COMPLETED',
        current_step: 'finished_declined',
        result_summary: `اعتذر الطرف الآخر قائلاً: "${cleanText}"`,
        historyEvent: { event: 'TARGET_DECLINED', reply: cleanText }
      });

      const replyToTarget = `ولا يهمك أستاذ ${targetAlias}، ألف شكر لك، وبننسق بوقت ثاني بكون مناسب لحضرتك إن شاء الله 🌸`;
      await toolRegistry.execute('whatsapp.send', { toPhone: fromPhone, messageText: replyToTarget });

      const alertToAhmad = `أستاذ أحمد، رد ${targetName} (${targetAlias}) واعتذر عن الموعد قائلاً:
"${cleanText}"
بلّغته إنه بننسق بوقت ثاني مناسب لحضرتك ولإله 👍`;

      return { replyToTarget, alertToAhmad, status: 'COMPLETED' };
    }

    if (hasTime || (isAccept && cleanText.length > 5)) {
      const tomorrow = new Date();
      tomorrow.setHours(20, 0, 0, 0);

      dbService.createCalendarEvent({
        title: ctx.intentType === 'dinner_invite' ? `عشاء مع ${targetName}` : `اجتماع مع ${targetName}`,
        participant_phone: fromPhone,
        participant_name: targetName,
        start_time: tomorrow.toISOString(),
        location: 'حسب التنسيق',
        notes: `تم التنسيق ذاتياً عبر نور: "${cleanText}"`
      });

      dbService.updateLifecycleTask(taskCode, {
        status: 'COMPLETED',
        current_step: 'confirmed',
        result_summary: `تم التأكيد بنجاح: "${cleanText}"`,
        historyEvent: { event: 'CONFIRMED', reply: cleanText }
      });

      await memoryEngine.recordLongTermFact({
        entityPhone: fromPhone,
        entityName: targetName,
        fact: `وافق على ${ctx.intentType === 'dinner_invite' ? 'العشاء' : 'الاجتماع'} وكان رده: "${cleanText}".`,
        source: 'task_confirmation'
      });

      const replyToTarget = `ممتاز جداً أستاذ ${targetAlias}! تم تثبيت الموعد وبلغت الأستاذ أحمد فوراً. نلتقي على خير ويسعد مساك 🌸`;
      await toolRegistry.execute('whatsapp.send', { toPhone: fromPhone, messageText: replyToTarget });

      const alertToAhmad = `أستاذ أحمد، رد ${targetName} (${targetAlias}) وموافق على الموعد! 🎉
رده: "${cleanText}"
وثبّتت الموعد عندك على التقويم. كل الأمور جاهزة تمام 👍`;

      return { replyToTarget, alertToAhmad, status: 'COMPLETED' };
    }

    const replyToTarget = `تمام أستاذ ${targetAlias} 🌸 أي وقت أو ساعة بالتحديد بتناسبك حتى أثبتها مع الأستاذ أحمد؟`;
    
    dbService.updateLifecycleTask(taskCode, {
      status: 'WAITING_FOR_REPLY',
      current_step: 'negotiating_time',
      historyEvent: { event: 'ASKED_FOR_EXACT_TIME', targetReply: cleanText }
    });

    await toolRegistry.execute('whatsapp.send', { toPhone: fromPhone, messageText: replyToTarget });

    const alertToAhmad = `أستاذ أحمد، رد ${targetName} (${targetAlias}) وقال: "${cleanText}".
رجعت سألته بلطف عن الساعة المحددة حتى نثبتها وأول ما يرد ببلغك فوراً.`;

    return { replyToTarget, alertToAhmad, status: 'WAITING_FOR_REPLY' };
  }

  /**
   * Handle Ahmad's decision/answer to a pending question
   */
  async handleAhmadDecisionForTask(activeTask, ahmadText, apiKey = null) {
    const cleanText = (ahmadText || '').trim();
    const taskCode = activeTask.task_code;
    const ctx = activeTask.context || {};
    const targetPhone = ctx.targetPhone;
    const targetName = ctx.targetName || 'المطعم';
    const pendingDecision = ctx.pendingDecision || '';
    const orderDetails = ctx.orderDetails || ctx.initialInstruction || '';

    const systemPrompt = `
أنتِ "نور"، السكرتيرة التنفيذية للأستاذ أحمد العامودي.
هناك مهمة أو أوردر جاري مع الطرف الثالث (${targetName} - ${targetPhone}).
الموضوع أو الاستفسار السابق: ${pendingDecision}
تفاصيل الطلب: ${orderDetails}
رد وقرار الأستاذ أحمد الآن: "${cleanText}"

مهمتك:
1. صياغة رد لبق، احترافي، وواضح للمطعم/الطرف الثالث ينقل قرار الأستاذ أحمد بالكامل.
2. صياغة رسالة تأكيد لطيفة للأستاذ أحمد تبلغه بما أرسلتِه للمطعم.
3. هل هذا الرد يحسم ويثبت الطلب نهائياً، أم يحتاج رداً إضافياً من المطعم؟

أعيدي JSON فقط:
{
  "messageToTarget": "نص الرسالة للمطعم",
  "confirmToAhmad": "نص التأكيد لأحمد",
  "isFinalizing": boolean
}
`;

    const decisionPlan = await this.callGeminiJson(apiKey, systemPrompt, cleanText);

    let msgToTarget = decisionPlan?.messageToTarget || `تمام، الأستاذ أحمد أكد إنه: ${cleanText}. يا ريت تباشروا التجهيز، شكراً لكم!`;
    let confirmToAhmad = decisionPlan?.confirmToAhmad || `أبشر أستاذ أحمد! بلّغت المطعم فوراً بقرارك: "${cleanText}"، وأول ما يجهز الأوردر بطمنك 👍`;

    if (targetPhone) {
      await toolRegistry.execute('whatsapp.send', {
        toPhone: targetPhone,
        messageText: msgToTarget,
        reason: `Ahmad decision forwarded for task ${taskCode}`
      });
    }

    dbService.updateLifecycleTask(taskCode, {
      status: decisionPlan?.isFinalizing ? 'COMPLETED' : 'WAITING_FOR_REPLY',
      current_step: decisionPlan?.isFinalizing ? 'order_finalized' : 'awaiting_target_final_reply',
      historyEvent: {
        event: 'AHMAD_DECISION_DISPATCHED',
        ahmadDecision: cleanText,
        sentToTarget: msgToTarget
      }
    });

    return {
      confirmToAhmad,
      messageToTarget: msgToTarget
    };
  }
}

module.exports = new TaskEngine();
