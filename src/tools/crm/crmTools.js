
const dbService = require('../../db/database');
const identityResolver = require('../../people/identity-resolution/identityResolver');
const auditService = require('../../security/audit');

module.exports = {
  async resolvePerson({ query }) {
    return identityResolver.resolve(query);
  },

  async updateContact({ phone, name, alias = '', relation = 'عميل', company = '', notes = '' }) {
    const updated = dbService.upsertIdentity({
      canonical_name: name,
      phone,
      primary_alias: alias,
      relationship_type: relation,
      company,
      notes
    });

    if (alias) {
      dbService.addIdentityAlias(updated.id, alias, 'nickname', 'agent_tool', 0.95);
    }

    auditService.log({
      actorPhone: '962782932611',
      actorName: 'Nour AI',
      actionType: 'CRM_UPDATE',
      toolName: 'crm.update',
      toolInput: { phone, name, alias, relation, company },
      toolOutput: { id: updated.id, name: updated.canonical_name },
      riskLevel: 'MEDIUM',
      whyReason: 'حفظ وتحديث بيانات جهة الاتصال في النظام'
    });

    return updated;
  }
};
