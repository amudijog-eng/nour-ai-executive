/**
 * CRM Service for WhatsApp AI Agent
 * Manages customer directory, search by name/nickname, profiling, and metadata.
 */
const dbService = require('../db/database');

class CrmService {
  /**
   * Search for a contact in the CRM by name, nickname, or partial string
   */
  findContact(nameOrQuery) {
    if (!nameOrQuery) return null;
    return dbService.searchCrmContact(nameOrQuery);
  }

  /**
   * Get contact by phone number
   */
  getContactByPhone(phone) {
    if (!phone) return null;
    return dbService.getCrmContactByPhone(phone);
  }

  /**
   * Get all CRM contacts
   */
  getAllContacts() {
    return dbService.getCrmContacts();
  }

  /**
   * Upsert a contact in the CRM
   */
  saveContact(contactData) {
    return dbService.upsertCrmContact(contactData);
  }

  /**
   * Delete a contact by ID
   */
  deleteContact(id) {
    return dbService.deleteCrmContact(id);
  }

  /**
   * Format contact details as a clean summary card
   */
  formatContactCard(contact) {
    if (!contact) return 'لا توجد بيانات متاحة لهذا العميل.';
    return `
👤 *${contact.full_name}* ${contact.nickname ? `(${contact.nickname})` : ''}
📱 الهاتف: ${contact.phone}
🏢 الجهة/الشركة: ${contact.company || 'غير محدد'}
🏷️ التصنيف: ${contact.relation || 'عميل'}
📝 ملاحظات: ${contact.notes || 'لا توجد'}
    `.trim();
  }
}

module.exports = new CrmService();
