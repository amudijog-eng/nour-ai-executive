
const dbService = require('../../db/database');
const auditService = require('../../security/audit');

module.exports = {
  async create({ goal, ownerPhone = '962782932611', participants = [], deadline = null, steps = [], context = {} }) {
    const task = dbService.createLifecycleTask({
      goal,
      owner_phone: ownerPhone,
      participants,
      deadline,
      steps,
      context,
      required_approval: 0
    });

    auditService.log({
      actorPhone: ownerPhone,
      actorName: 'Nour AI',
      actionType: 'TASK_CREATE',
      toolName: 'tasks.create',
      toolInput: { goal, participants },
      toolOutput: { taskCode: task.task_code, status: task.status },
      riskLevel: 'MEDIUM',
      whyReason: 'إنشاء مهمة تنفيذية ذاتية المتابعة'
    });

    return task;
  },

  async update({ taskCode, status, currentStep, resultSummary, contextUpdate, historyEvent }) {
    return dbService.updateLifecycleTask(taskCode, {
      status,
      current_step: currentStep,
      result_summary: resultSummary,
      context: contextUpdate,
      historyEvent
    });
  },

  async get({ taskCode }) {
    return dbService.getLifecycleTask(taskCode);
  },

  async getActiveForPhone({ phone }) {
    return dbService.getActiveLifecycleTaskForPhone(phone);
  }
};
