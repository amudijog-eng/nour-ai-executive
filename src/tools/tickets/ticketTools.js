
const dbService = require('../../db/database');

module.exports = {
  async reply({ ticketNumber, replyText }) {
    const ticket = dbService.updateTicketAdminReply(ticketNumber.toUpperCase(), replyText);
    if (!ticket) {
      throw new Error(`لا توجد تذكرة بالرقم (${ticketNumber})`);
    }

    const customerMsg = `مرحبا أستاذ ${ticket.customer_name || ''} 🌸 يسعد أوقاتك.
الأستاذ أحمد العامودي راجع موضوعك (#${ticket.ticket_number}) وقلك:
"${replyText}"`;

    return {
      ticket,
      customerPhone: ticket.customer_phone,
      messageToCustomer: customerMsg
    };
  }
};
