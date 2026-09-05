
const dbService = require('../db/database');

class AuditService {
  log({
    actorPhone,
    actorName = '',
    actionType,
    toolName = '',
    toolInput = {},
    toolOutput = {},
    riskLevel = 'LOW',
    authorizationStatus = 'AUTHORIZED',
    whyReason = ''
  }) {
    try {
      return dbService.addAuditLog({
        actor_phone: actorPhone,
        actor_name: actorName,
        action_type: actionType,
        tool_name: toolName,
        tool_input: toolInput,
        tool_output: toolOutput,
        risk_level: riskLevel,
        authorization_status: authorizationStatus,
        why_reason: whyReason
      });
    } catch (e) {
      console.warn('⚠️ Audit Logging Warning:', e.message);
      return null;
    }
  }
}

module.exports = new AuditService();
