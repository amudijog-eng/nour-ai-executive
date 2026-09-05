
class AccessControl {
  /**
   * Filter context data according to the caller's authorized classification
   * Levels: PUBLIC < INTERNAL < PRIVATE < SENSITIVE < SYSTEM
   */
  filterContextForCaller(callerRole, contextData = {}) {
    if (callerRole === 'OWNER') {
      // Owner has unrestricted access to all data classifications
      return contextData;
    }

    // External callers only get PUBLIC data
    const sanitized = {
      services: contextData.publicServices || 'خدمات مكتب سند تاكسي وخدمات النقل والأعمال',
      companyName: 'مكتب الأستاذ أحمد العامودي (سند تاكسي)',
      contactHours: 'يومياً على مدار الساعة'
    };

    return sanitized;
  }

  isAuthorizedForTool(callerRole, toolName, toolRiskLevel) {
    if (callerRole === 'OWNER') {
      return { allowed: true };
    }

    // External callers can only access read-only / public tools
    const externalAllowedTools = ['whatsapp.read', 'public.info'];
    if (externalAllowedTools.includes(toolName)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `غير مصرح بتشغيل الأداة (${toolName}) لغير المشرف العام الأستاذ أحمد`
    };
  }
}

module.exports = new AccessControl();
