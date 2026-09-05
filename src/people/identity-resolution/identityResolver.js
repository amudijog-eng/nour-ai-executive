
const dbService = require('../../db/database');

class IdentityResolver {
  normalizePhone(phone) {
    if (!phone) return '';
    let clean = String(phone).replace(/\D/g, '');
    if (clean.startsWith('00')) clean = clean.slice(2);
    if (clean.startsWith('07') && clean.length === 10) {
      clean = '962' + clean.slice(1);
    } else if (clean.startsWith('7') && clean.length === 9) {
      clean = '962' + clean;
    }
    return clean;
  }

  normalizeArabic(text) {
    if (!text) return '';
    return text.toLowerCase()
      .replace(/[إأآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim();
  }

  async resolve(query) {
    if (!query) return null;
    const cleanStr = String(query).trim();
    const cleanPhone = this.normalizePhone(cleanStr);
    const isPhoneLike = /^[0-9+]{7,16}$/.test(cleanStr.replace(/\s/g, ''));

    // 1. Direct Phone Lookup
    if (isPhoneLike && cleanPhone) {
      const identity = dbService.getIdentityByPhone(cleanPhone);
      if (identity) {
        return this.buildPersonProfile(identity, 1.0);
      }

      const crm = dbService.getCrmContactByPhone(cleanPhone);
      if (crm) {
        const synced = dbService.upsertIdentity({
          canonical_name: crm.full_name,
          phone: cleanPhone,
          primary_alias: crm.nickname || '',
          relationship_type: crm.relation || 'عميل',
          company: crm.company || '',
          confidence: 0.95,
          notes: crm.notes || ''
        });
        if (crm.nickname) {
          dbService.addIdentityAlias(synced.id, crm.nickname, 'nickname', 'crm_migration', 0.95);
        }
        return this.buildPersonProfile(synced, 0.95);
      }

      const waContact = dbService.getContact(cleanPhone);
      if (waContact && waContact.name && waContact.name !== cleanPhone && waContact.name !== 'غير محدد') {
        return {
          id: null,
          name: waContact.name,
          aliases: [],
          phone: cleanPhone,
          relationship: 'جهة اتصال واتساب',
          company: '',
          lastInteraction: waContact.last_updated,
          recentTopics: [],
          currentStatus: 'نشط',
          confidence: 0.85,
          isAmbiguous: false
        };
      }

      return {
        id: null,
        name: `رقم (${cleanPhone})`,
        aliases: [],
        phone: cleanPhone,
        relationship: 'رقم غير مسجل',
        company: '',
        lastInteraction: null,
        recentTopics: [],
        currentStatus: 'جديد',
        confidence: 0.50,
        isAmbiguous: true
      };
    }

    // 2. Name or Alias Lookup
    const normTarget = this.normalizeArabic(cleanStr);
    const allIdentities = dbService.getAllIdentities();

    let bestMatch = null;
    let highestScore = 0;

    for (const iden of allIdentities) {
      const normCanonical = this.normalizeArabic(iden.canonical_name);
      const normPrimary = this.normalizeArabic(iden.primary_alias);

      if (normCanonical === normTarget || normPrimary === normTarget) {
        return this.buildPersonProfile(iden, 0.98);
      }

      for (const al of (iden.aliases || [])) {
        const normAlias = this.normalizeArabic(al.alias);
        if (normAlias === normTarget) {
          return this.buildPersonProfile(iden, 0.96);
        }
        if (normAlias.includes(normTarget) || normTarget.includes(normAlias)) {
          if (0.88 > highestScore) {
            highestScore = 0.88;
            bestMatch = iden;
          }
        }
      }

      if (normCanonical.includes(normTarget) || normTarget.includes(normCanonical)) {
        if (0.85 > highestScore) {
          highestScore = 0.85;
          bestMatch = iden;
        }
      }
    }

    if (!bestMatch) {
      const crmMatch = dbService.searchCrmContact(cleanStr);
      if (crmMatch) {
        const synced = dbService.upsertIdentity({
          canonical_name: crmMatch.full_name,
          phone: crmMatch.phone,
          primary_alias: crmMatch.nickname || '',
          relationship_type: crmMatch.relation || 'عميل',
          company: crmMatch.company || '',
          confidence: 0.90,
          notes: crmMatch.notes || ''
        });
        if (crmMatch.nickname) {
          dbService.addIdentityAlias(synced.id, crmMatch.nickname, 'nickname', 'crm_migration', 0.90);
        }
        return this.buildPersonProfile(synced, 0.90);
      }
    }

    if (bestMatch && highestScore >= 0.70) {
      return this.buildPersonProfile(bestMatch, highestScore);
    }

    return null;
  }

  buildPersonProfile(identity, confidence) {
    const phone = identity.phone;
    const aliases = (identity.aliases || []).map(a => a.alias);
    if (identity.primary_alias && !aliases.includes(identity.primary_alias)) {
      aliases.unshift(identity.primary_alias);
    }

    let lastInteraction = identity.updated_at;
    let recentTopics = [];
    let currentStatus = 'مستقر';

    if (phone) {
      const lastMsgs = dbService.getRecentContext(phone, 4);
      if (lastMsgs.length > 0) {
        recentTopics = lastMsgs.map(m => m.text.slice(0, 40));
      }
      const activeTask = dbService.getActiveLifecycleTaskForPhone(phone);
      if (activeTask) {
        currentStatus = `مهمة جارية: ${activeTask.goal} (${activeTask.status})`;
      }
    }

    return {
      id: identity.id,
      name: identity.canonical_name,
      aliases,
      phone,
      relationship: identity.relationship_type,
      company: identity.company || '',
      notes: identity.notes || '',
      lastInteraction,
      recentTopics,
      currentStatus,
      confidence,
      isAmbiguous: confidence < 0.75
    };
  }
}

module.exports = new IdentityResolver();
