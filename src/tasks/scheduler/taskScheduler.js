
const dbService = require('../../db/database');

class TaskScheduler {
  getPendingTasksSummary() {
    const tasks = dbService.getAllLifecycleTasks('WAITING_FOR_REPLY');
    if (tasks.length === 0) return 'لا يوجد مهام معلقة بانتظار الرد حالياً.';

    const lines = tasks.map(t => {
      const target = t.context?.targetName || t.participants?.[0] || 'غير محدد';
      return `- [${t.task_code}] ${t.goal} (الطرف: ${target})`;
    });
    return `المهام الجارية بانتظار الرد:
${lines.join('\n')}`;
  }
}

module.exports = new TaskScheduler();
