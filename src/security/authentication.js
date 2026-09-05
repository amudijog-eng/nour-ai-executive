
const OWNER_PHONE = '962782932611';

class Authentication {
  getOwnerPhone() {
    return OWNER_PHONE;
  }

  normalizePhone(phone) {
    if (!phone) return '';
    let clean = String(phone).replace(/\D/g, '');
    if (clean.startsWith('00')) clean = clean.slice(2);
    if (clean.startsWith('07') && clean.length === 10) clean = '962' + clean.slice(1);
    if (clean.startsWith('7') && clean.length === 9) clean = '962' + clean;
    return clean;
  }

  authenticate(callerPhone, messageText = '') {
    const cleanCaller = this.normalizePhone(callerPhone);
    const isOwner = cleanCaller === OWNER_PHONE || cleanCaller.endsWith(OWNER_PHONE.slice(-9));

    if (isOwner) {
      return {
        isAuthenticated: true,
        role: 'OWNER',
        ownerPhone: OWNER_PHONE,
        callerPhone: cleanCaller,
        permissions: ['ALL_PERMISSIONS']
      };
    }

    // Check for Impersonation attempts
    const cleanText = (messageText || '').toLowerCase();
    const claimsAhmad = (cleanText.includes('أحمد') || cleanText.includes('احمد')) && 
                        (cleanText.includes('أنا') || cleanText.includes('انا') || cleanText.includes('معك') || cleanText.includes('معاك'));
    const givesOrders = /(?:ابعتي|ابعثي|ارسل|ارسلي|سوي|اعملي|غيري|احذفي|بدي تبعثي|احكيله|قله|خبره|اتصلي)/iu.test(cleanText);

    if (claimsAhmad || givesOrders) {
      return {
        isAuthenticated: false,
        role: 'IMPERSONATOR',
        callerPhone: cleanCaller,
        isSecurityThreat: true,
        threatReason: 'محاولة إعطاء أوامر أو ادعاء هوية الأستاذ أحمد من رقم غير معتمد'
      };
    }

    return {
      isAuthenticated: true,
      role: 'EXTERNAL_CLIENT',
      callerPhone: cleanCaller,
      permissions: ['PUBLIC_INTERACTION']
    };
  }
}

module.exports = new Authentication();
