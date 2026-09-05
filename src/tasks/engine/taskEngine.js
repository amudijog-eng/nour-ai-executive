
const dbService = require('../../db/database');
const toolRegistry = require('../../tools/registry');
const memoryEngine = require('../../core/memory/memoryEngine');

class TaskEngine {
  /**
   * Start an autonomous coordination task (e.g. Meeting, Dinner, Follow-up)
   */
  async startTask({ instruction, targetPerson, intentType = 'general', ownerPhone = '962782932611' }) {
    const targetPhone = targetPerson.phone;
    const targetName = targetPerson.name;
    const targetAlias = targetPerson.aliases?.[0] || targetName;

    // Craft human, warm, executive message from Ahmad Alamoudi's office
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

    // Create persistent task object
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
        lastMessageToTarget: messageToTarget
      }
    });

    // Update status to WAITING_FOR_REPLY
    dbService.updateLifecycleTask(task.task_code, {
      status: 'WAITING_FOR_REPLY',
      current_step: 'await_reply',
      historyEvent: {
        event: 'OUTBOUND_MESSAGE_DISPATCHED',
        to: targetPhone,
        text: messageToTarget
      }
    });

    // Send WhatsApp to target contact
    await toolRegistry.execute('whatsapp.send', {
      toPhone: targetPhone,
      messageText: messageToTarget,
      reason: goal,
      actorPhone: ownerPhone
    });

    // Record episodic memory
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
   * Handle incoming response from the target contact
   */
  async handleTargetReply(activeTask, text, fromPhone) {
    const cleanText = (text || '').trim();
    const taskCode = activeTask.task_code;
    const ctx = activeTask.context || {};
    const targetName = ctx.targetName || 'الطرف الآخر';
    const targetAlias = ctx.targetAlias || targetName;

    const lower = cleanText.toLowerCase();

    // Check intent in reply:
    // 1. Acceptance with specific time
    const hasTime = /(?:الساعة|ساعه|ع\s*الساعة|\b[1-9]|1[0-2]\b|مساء|عصرا|صباحا)/i.test(cleanText);
    const isAccept = /(?:موافق|تمام|ماشي|أكيد|اكيد|بناسبني|جاهز|يسعدك|ان شاء الله|إن شاء الله|هلا والله)/i.test(cleanText);
    const isReject = /(?:اعتذر|بعتذر|مش فاضي|صعب|مشغول|ما بقدر|ما بقدرش|بلاش اليوم|خليه وقت ثاني)/i.test(cleanText);

    // Case 1: Polite Refusal / Reschedule
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

    // Case 2: Acceptance with specific time -> Complete & Add Calendar Event
    if (hasTime || (isAccept && cleanText.length > 5)) {
      // Create calendar event
      const tomorrow = new Date();
      tomorrow.setHours(20, 0, 0, 0); // Default evening 8:00 PM if time not exact

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

      // Update relationship memory
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

    // Case 3: Incomplete answer (e.g. says only "الخميس" or "موافق" without specifying time) -> Multi-turn negotiation
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
}

module.exports = new TaskEngine();
