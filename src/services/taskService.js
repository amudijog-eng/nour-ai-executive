/**
 * Autonomous Agent Task Service (Natural Human Tone - No Templates)
 */
const dbService = require('../db/database');
const crmService = require('./crmService');

const AHMAD_PHONE = '962782932611';

class TaskService {
  detectAdminTaskIntent(text) {
    if (!text) return null;
    const clean = text.trim();

    const taskRegex = /^(?:مرحبا\s+|هلا\s+|يا هلا\s+|كيفك\s+|مساء الخير\s+)?(?:شوفلي|احكي مع|تواصل مع|اسألي|اسأل|كلم|نسق مع|نسقلي مع|اتصلي بـ?|خبر|ابعث لـ?|احكي لـ?)\s+([\p{L}\s]{2,25}?)(?:\s+(?:اذا|إذا|لو|عشان|بخصوص|عن|متى|وين|شو|هل|ايمتى|إذا ممكن|اذا ممكن|بدنا|ممكن|ع العشا|ع الغدا|نطلع|نجتمع|موعد).*)?$/iu;

    const match = clean.match(taskRegex);
    if (!match) return null;

    const rawTargetName = match[1].trim();

    let intentType = 'general';
    const lower = clean.toLowerCase();
    if (lower.includes('عشا') || lower.includes('غدا') || lower.includes('أكل') || lower.includes('مطعم') || lower.includes('dinner')) {
      intentType = 'dinner_invite';
    } else if (lower.includes('اجتماع') || lower.includes('موعد') || lower.includes('لقاء') || lower.includes('meeting')) {
      intentType = 'meeting_request';
    } else if (lower.includes('سعر') || lower.includes('عرض') || lower.includes('ملف') || lower.includes('تقرير')) {
      intentType = 'inquiry';
    }

    return {
      rawTargetName,
      instruction: clean,
      intentType
    };
  }

  async initiateTask({ instruction, targetContact, intentType = 'general' }) {
    const task = dbService.createAgentTask({
      requester_phone: AHMAD_PHONE,
      target_phone: targetContact.phone,
      target_name: targetContact.full_name,
      intent_type: intentType,
      instruction: instruction
    });

    const messageToTarget = this.craftOutboundMessage(targetContact, instruction, intentType);

    dbService.updateAgentTask(task.task_code, {
      last_agent_message: messageToTarget,
      status: 'in_progress'
    });

    // Warm, natural confirmation to Ahmad
    const confirmToAhmad = `أبشر أستاذ أحمد 👍 تواصلت مع أستاذ ${targetContact.full_name} وبعثت له:
"${messageToTarget}"

أول ما يرد علي بعطيك خبر فوراً 🌸`;

    return {
      task,
      targetPhone: targetContact.phone,
      messageToTarget,
      confirmToAhmad
    };
  }

  craftOutboundMessage(contact, instruction, intentType) {
    const nameStr = contact.nickname ? `أستاذ ${contact.full_name} (${contact.nickname})` : `أستاذ ${contact.full_name}`;

    if (intentType === 'dinner_invite') {
      let timeHint = 'اليوم';
      if (instruction.includes('بكرة') || instruction.includes('غدا') || instruction.includes('غداً')) {
        timeHint = 'بكرة';
      }

      return `مرحبا ${nameStr} يسعد مساك 🌸
الأستاذ أحمد العامودي بسأل حضرتك إذا بناسبك تطلعوا سوا ع العشا ${timeHint}؟ 🍽️
إذا الوقت بناسبك أو بتحب نقترح موعد ثاني خبرني لأرتب معكم فوراً.`;
    }

    if (intentType === 'meeting_request') {
      return `مرحبا ${nameStr} يسعد أوقاتك 🌸
معك سكرتيرة الأستاذ أحمد العامودي. الأستاذ أحمد حاب يرتب اجتماع مع حضرتك، متى بناسبك الموعد واليوم الأفضل لجدولك؟`;
    }

    return `مرحبا ${nameStr}، بتواصل معك من مكتب الأستاذ أحمد العامودي بخصوص: ${instruction.replace(/^(?:شوفلي|احكي مع|تواصل مع|اسألي|اسأل|كلم)\s+[\p{L}\s]{2,20}/u, '').trim()}.
يا ريت تفيدنا برأيك لأبلغ الأستاذ أحمد فوراً 🌸`;
  }

  async handleTargetReply(task, replyText) {
    const text = replyText.trim();

    dbService.updateAgentTask(task.task_code, {
      last_target_reply: text,
      status: 'completed',
      result_summary: text
    });

    const replyToTarget = `تسلم أستاذ ${task.target_name || ''}، كلك ذوق 🌸 نقلت ردك للأستاذ أحمد العامودي وبنأكد معك قريباً.`;

    const alertToAhmad = `أستاذ أحمد، رد علي أستاذ ${task.target_name} بخصوص العشا وقال:
"${text}"

بتحب أرد عليه بإشي معين أو أأكد الموعد؟ 🌸`;

    return {
      replyToTarget,
      alertToAhmad,
      updatedTask: dbService.getAgentTaskByCode(task.task_code)
    };
  }

  getActiveTask(phone) {
    return dbService.getActiveTaskForPhone(phone);
  }

  getAllTasks(status = null) {
    return dbService.getAgentTasks(status);
  }
}

module.exports = new TaskService();
