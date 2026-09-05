
const dbService = require('../../db/database');

class RelationshipGraph {
  getAhmadNetwork() {
    const identities = dbService.getAllIdentities();
    const network = {
      owner: 'أحمد العامودي (+962782932611)',
      contacts: []
    };

    for (const iden of identities) {
      if (iden.phone !== '962782932611') {
        network.contacts.push({
          name: iden.canonical_name,
          phone: iden.phone,
          relation: iden.relationship_type,
          company: iden.company,
          alias: iden.primary_alias
        });
      }
    }
    return network;
  }

  getRelationshipContext(phone) {
    const iden = dbService.getIdentityByPhone(phone);
    if (!iden) return 'علاقة غير مسجلة بعد';
    return `الطرف: ${iden.canonical_name} (${iden.primary_alias || ''}) | نوع العلاقة بالأستاذ أحمد: ${iden.relationship_type} | المؤسسة: ${iden.company || 'غير محدد'}`;
  }
}

module.exports = new RelationshipGraph();
