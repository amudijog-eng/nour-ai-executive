
class RiskEngine {
  evaluateActionRisk(toolName, parameters = {}) {
    // 1. High Risk Tools & Actions
    if (
      toolName === 'data.delete' ||
      toolName === 'system.reset' ||
      (toolName === 'financial.commit') ||
      (toolName === 'whatsapp.broadcast')
    ) {
      return {
        level: 'HIGH',
        requiresApproval: true,
        reason: 'إجراء عالي التأثير أو التزام مالي/حذف يتطلب موافقة صريحة من الأستاذ أحمد'
      };
    }

    // Check financial amounts in parameters
    const paramStr = JSON.stringify(parameters);
    if (/\b\d{4,}\s*(?:دينار|JOD|دولار|\$)/i.test(paramStr)) {
      return {
        level: 'HIGH',
        requiresApproval: true,
        reason: 'تم رصد مبلغ مالي كبير يتطلب مراجعة وتأكيد من الأستاذ أحمد'
      };
    }

    // 2. Medium Risk Actions (Sending messages, booking meetings, updating CRM)
    if (
      toolName === 'whatsapp.send' ||
      toolName === 'calendar.create' ||
      toolName === 'calendar.update' ||
      toolName === 'crm.update' ||
      toolName === 'tasks.create'
    ) {
      return {
        level: 'MEDIUM',
        requiresApproval: false,
        reason: 'إجراء تنفيذي معتاد للسكرتيرة مع التوثيق في سجل التدقيق'
      };
    }

    // 3. Low Risk (Search, Read, Summarize)
    return {
      level: 'LOW',
      requiresApproval: false,
      reason: 'عملية قراءة واسترجاع معلومات آمنة'
    };
  }
}

module.exports = new RiskEngine();
