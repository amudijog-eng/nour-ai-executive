// Connect Socket.io
const socket = io();

// State
let contacts = [];
let activeContact = null;
let tickets = [];
let activeFilter = 'all'; // 'all', 'unread', 'tickets'

// DOM Elements
const contactsListEl = document.getElementById('contactsList');
const noChatSelectedEl = document.getElementById('noChatSelected');
const chatWindowEl = document.getElementById('chatWindow');
const messagesContainerEl = document.getElementById('messagesContainer');
const chatInputFormEl = document.getElementById('chatInputForm');
const chatTextInputEl = document.getElementById('chatTextInput');
const activeNameEl = document.getElementById('activeName');
const activeStatusEl = document.getElementById('activeStatus');
const activeInitialsEl = document.getElementById('activeInitials');
const chatAiToggleEl = document.getElementById('chatAiToggle');
const aiTypingBarEl = document.getElementById('aiTypingBar');
const searchInputEl = document.getElementById('searchInput');
const ticketCountBadgeEl = document.getElementById('ticketCountBadge');
const ticketsDrawerEl = document.getElementById('ticketsDrawer');
const ticketsContainerEl = document.getElementById('ticketsContainer');

// Tabs
const tabAllEl = document.getElementById('tabAll');
const tabUnreadEl = document.getElementById('tabUnread');
const tabTicketsEl = document.getElementById('tabTickets');
const btnCloseTicketsDrawerEl = document.getElementById('btnCloseTicketsDrawer');

// Buttons & Modals
const btnQuickSimulateEl = document.getElementById('btnQuickSimulate');
const btnSimulateAhmadReplyEl = document.getElementById('btnSimulateAhmadReply');
const btnOpenSettingsEl = document.getElementById('btnOpenSettings');
const btnCloseSettingsEl = document.getElementById('btnCloseSettings');
const btnSaveSettingsEl = document.getElementById('btnSaveSettings');
const btnCheckMetaEl = document.getElementById('btnCheckMeta');
const settingsModalEl = document.getElementById('settingsModal');

const settingPhoneIdEl = document.getElementById('settingPhoneId');
const settingAccessTokenEl = document.getElementById('settingAccessToken');
const settingAiKeyEl = document.getElementById('settingAiKey');

// New Chat Modal
const btnOpenNewChatEl = document.getElementById('btnOpenNewChat');
const newChatModalEl = document.getElementById('newChatModal');
const btnCloseNewChatModalEl = document.getElementById('btnCloseNewChatModal');
const btnCancelNewChatEl = document.getElementById('btnCancelNewChat');
const newChatFormEl = document.getElementById('newChatForm');
const newChatPhoneEl = document.getElementById('newChatPhone');
const newChatNameEl = document.getElementById('newChatName');
const newChatMessageEl = document.getElementById('newChatMessage');

// Emojis & Attachments
const btnToggleEmojiEl = document.getElementById('btnToggleEmoji');
const emojiPickerPanelEl = document.getElementById('emojiPickerPanel');
const btnCloseEmojiPickerEl = document.getElementById('btnCloseEmojiPicker');
const emojiGridEl = document.getElementById('emojiGrid');

const btnToggleAttachEl = document.getElementById('btnToggleAttach');
const attachMenuEl = document.getElementById('attachMenu');
const btnAttachPhotoEl = document.getElementById('btnAttachPhoto');
const btnAttachDocEl = document.getElementById('btnAttachDoc');
const mediaFileInputEl = document.getElementById('mediaFileInput');

// Popular WhatsApp Emojis List
const EMOJIS = [
  '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊',
  '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘',
  '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭',
  '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏',
  '👍', '👎', '👏', '🙌', '🤝', '🙏', '❤️', '🔥',
  '✨', '🎉', '🚀', '💡', '📌', '📋', '⏱️', '🎫',
  '🌸', '☕', '⭐', '💯', '✅', '❌', '⚠️', '💼'
];

// Populate Emojis
emojiGridEl.innerHTML = EMOJIS.map(e => `
  <span class="hover:scale-125 transform transition text-center p-1" onclick="insertEmoji('${e}')">${e}</span>
`).join('');

function insertEmoji(emoji) {
  chatTextInputEl.value += emoji;
  chatTextInputEl.focus();
}

btnToggleEmojiEl.addEventListener('click', (e) => {
  e.stopPropagation();
  attachMenuEl.classList.add('hidden');
  emojiPickerPanelEl.classList.toggle('hidden');
});

btnCloseEmojiPickerEl.addEventListener('click', () => {
  emojiPickerPanelEl.classList.add('hidden');
});

// Attachments handling
btnToggleAttachEl.addEventListener('click', (e) => {
  e.stopPropagation();
  emojiPickerPanelEl.classList.add('hidden');
  attachMenuEl.classList.toggle('hidden');
});

btnAttachPhotoEl.addEventListener('click', () => {
  mediaFileInputEl.accept = 'image/*,video/*';
  attachMenuEl.classList.add('hidden');
  mediaFileInputEl.click();
});

btnAttachDocEl.addEventListener('click', () => {
  mediaFileInputEl.accept = '.pdf,.doc,.docx,.txt,.zip';
  attachMenuEl.classList.add('hidden');
  mediaFileInputEl.click();
});

// Upload file when chosen
mediaFileInputEl.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !activeContact) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      showToast(`جاري إرسال المرفق: ${file.name}...`);
      const res = await fetch('/api/upload-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: activeContact.phone,
          filename: file.name,
          base64Data: reader.result,
          caption: `📎 تم إرسال ملف: ${file.name}`
        })
      });
      if (res.ok) {
        showToast('تم إرسال المرفق بنجاح!');
        loadMessages(activeContact.phone);
      } else {
        showToast('فشل إرسال المرفق', true);
      }
    } catch (err) {
      showToast('خطأ برفع المرفق', true);
    }
  };
  reader.readAsDataURL(file);
});

// Close popups when clicking elsewhere
document.addEventListener('click', () => {
  emojiPickerPanelEl.classList.add('hidden');
  attachMenuEl.classList.add('hidden');
});
emojiPickerPanelEl.addEventListener('click', e => e.stopPropagation());
attachMenuEl.addEventListener('click', e => e.stopPropagation());

// Toast Notification
function showToast(text, isError = false) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  toastMsg.textContent = text;
  toast.className = `fixed bottom-6 left-6 z-50 font-bold px-4 py-2.5 rounded-xl shadow-2xl transform transition-all duration-300 flex items-center gap-2 text-xs ${
    isError ? 'bg-rose-600 text-white' : 'bg-[#00a884] text-[#111b21]'
  }`;
  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3500);
}

// WhatsApp-style Markdown Parser
function parseWAMarkdown(text) {
  if (!text) return '';
  let safe = escapeHtml(text);

  // Check if image link inside
  safe = safe.replace(/(\/uploads\/[a-zA-Z0-9._-]+)/g, '<div class="my-2 rounded-xl overflow-hidden border border-white/10"><img src="$1" class="max-h-60 rounded-lg object-cover cursor-pointer" onclick="window.open(\'$1\', \'_blank\')"></div>');

  // *bold*
  safe = safe.replace(/\*([^\*]+)\*/g, '<strong>$1</strong>');
  // _italic_
  safe = safe.replace(/_([^_]+)_/g, '<em>$1</em>');
  // ~strikethrough~
  safe = safe.replace(/~([^~]+)~/g, '<del>$1</del>');
  // `code`
  safe = safe.replace(/`([^`]+)`/g, '<code class="bg-black/30 px-1.5 py-0.5 rounded text-amber-300 font-mono text-[11px]">$1</code>');

  return safe;
}

// Format Time
function formatWATime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

// 1. Load Contacts
async function loadContacts() {
  try {
    const res = await fetch('/api/contacts');
    contacts = await res.json();
    renderContacts();
  } catch (err) {
    console.error('Error loading contacts:', err);
  }
}

function renderContacts(customList = null) {
  const list = customList || contacts;

  if (list.length === 0) {
    contactsListEl.innerHTML = `
      <div class="p-8 text-center text-[#8696a0] text-xs">
        <i class="fa-regular fa-comment-dots text-3xl mb-2 opacity-30"></i>
        <p>لا توجد محادثات حتى الآن</p>
        <button onclick="document.getElementById('btnOpenNewChat').click()" class="mt-3 text-[#00a884] hover:underline font-bold text-xs">
          + بدء محادثة جديدة الآن
        </button>
      </div>
    `;
    return;
  }

  contactsListEl.innerHTML = list.map(c => {
    const isActive = activeContact && activeContact.phone === c.phone;
    const initials = (c.name || c.phone).slice(0, 2);
    const isAhmad = c.phone.includes('782932611');
    const contactTicket = tickets.find(t => t.customer_phone === c.phone && t.status === 'open');

    return `
      <div class="wa-chat-item p-3 flex items-center gap-3 cursor-pointer hover:bg-[#202c33] transition relative ${isActive ? 'active' : ''}"
           onclick="selectContact('${c.phone}')">
        <div class="w-12 h-12 rounded-full ${isAhmad ? 'bg-gradient-to-tr from-amber-500 to-orange-400' : 'bg-[#6b7c85]'} text-white flex items-center justify-center font-bold text-sm shrink-0">
          ${isAhmad ? '<i class="fa-solid fa-crown text-sm"></i>' : initials}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between">
            <h4 class="font-semibold text-sm text-[#e9edef] truncate flex items-center gap-1.5">
              ${escapeHtml(c.name || c.phone)}
              ${isAhmad ? '<span class="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-mono font-bold">Admin</span>' : ''}
            </h4>
            <span class="text-[11px] text-[#8696a0] font-light">${formatWATime(c.last_updated)}</span>
          </div>
          <div class="flex items-center justify-between mt-1">
            <p class="text-xs text-[#8696a0] truncate flex-1">${escapeHtml(c.last_message || 'محادثة جديدة')}</p>
            <div class="flex items-center gap-1.5 shrink-0 mr-2">
              ${contactTicket ? `
                <span class="ticket-badge text-[10px] font-bold px-1.5 py-0.5 rounded font-mono">
                  #${contactTicket.ticket_number}
                </span>
              ` : ''}
              ${c.unread_count > 0 ? `
                <span class="w-5 h-5 rounded-full bg-[#00a884] text-[#111b21] font-bold text-[10px] flex items-center justify-center">
                  ${c.unread_count}
                </span>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 2. Select Contact
async function selectContact(phone) {
  const contact = contacts.find(c => c.phone === phone);
  if (!contact) return;

  activeContact = contact;
  activeContact.unread_count = 0;
  renderContacts();

  noChatSelectedEl.classList.add('hidden');
  chatWindowEl.classList.remove('hidden');

  const isAhmad = contact.phone.includes('782932611');
  activeNameEl.innerHTML = `
    <span>${escapeHtml(contact.name || contact.phone)}</span>
    ${isAhmad ? '<span class="text-amber-400 text-xs mr-1 font-bold">[المشرف العام]</span>' : '<i class="fa-solid fa-circle-check text-[#53bdeb] text-xs mr-1" title="حساب موثق"></i>'}
  `;
  activeInitialsEl.textContent = (contact.name || contact.phone).slice(0, 2);
  chatAiToggleEl.checked = Boolean(contact.ai_enabled);
  activeStatusEl.textContent = isAhmad ? 'المشرف العام (أحمد العامودي)' : 'متصل الآن عبر واتساب';

  await loadMessages(phone);
}

// 3. Load Messages
async function loadMessages(phone) {
  try {
    const res = await fetch(`/api/messages/${phone}`);
    const msgs = await res.json();
    renderMessages(msgs);
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

function renderMessages(msgs) {
  messagesContainerEl.innerHTML = msgs.map(m => {
    const isOut = m.direction === 'outgoing';
    const isTicketMsg = m.text.includes('#TK-');

    return `
      <div class="flex flex-col ${isOut ? 'items-start' : 'items-end'} animate-msg">
        <div class="max-w-lg md:max-w-xl px-3.5 py-2 text-xs leading-relaxed ${isOut ? 'wa-bubble-out' : 'wa-bubble-in'} text-[#e9edef]">
          ${isTicketMsg ? `
            <div class="mb-1.5 pb-1 border-b border-white/10 text-[10px] text-amber-400 font-bold flex items-center gap-1.5">
              <i class="fa-solid fa-ticket text-sm"></i>
              <span>بطاقة تذكرة دعم معتمدة</span>
            </div>
          ` : ''}
          <div class="whitespace-pre-wrap leading-relaxed">${parseWAMarkdown(m.text)}</div>
          <div class="flex items-center justify-end gap-1.5 mt-1 text-[10px] text-[#8696a0]">
            <span>${formatWATime(m.created_at)}</span>
            ${isOut ? '<i class="fa-solid fa-check-double text-[#53bdeb] text-[10px]"></i>' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
}

// 4. Send Message (Manual)
chatInputFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatTextInputEl.value.trim();
  if (!text || !activeContact) return;

  chatTextInputEl.value = '';

  try {
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: activeContact.phone,
        text
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'فشل الإرسال', true);
    }
  } catch (err) {
    showToast('خطأ في إرسال الرسالة', true);
  }
});

// 5. New Conversation Modal
btnOpenNewChatEl.addEventListener('click', () => {
  newChatModalEl.classList.remove('hidden');
  newChatPhoneEl.focus();
});
btnCloseNewChatModalEl.addEventListener('click', () => newChatModalEl.classList.add('hidden'));
btnCancelNewChatEl.addEventListener('click', () => newChatModalEl.classList.add('hidden'));

newChatFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = newChatPhoneEl.value.replace(/\D/g, '');
  const name = newChatNameEl.value.trim();
  const text = newChatMessageEl.value.trim();

  if (!phone || !text) {
    showToast('يرجى إدخال رقم الهاتف والرسالة', true);
    return;
  }

  try {
    showToast('جاري إرسال الرسالة وبدء المحادثة...');
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, text })
    });
    const data = await res.json();

    if (res.ok) {
      newChatModalEl.classList.add('hidden');
      newChatPhoneEl.value = '';
      newChatNameEl.value = '';
      newChatMessageEl.value = '';
      showToast('تم بدء المحادثة بنجاح!');
      await loadContacts();
      selectContact(phone);
    } else {
      showToast(data.error || 'فشل بدء المحادثة', true);
    }
  } catch (err) {
    showToast('خطأ بالاتصال', true);
  }
});

// 6. Toggle AI per Chat
chatAiToggleEl.addEventListener('change', async (e) => {
  if (!activeContact) return;
  const enabled = e.target.checked;
  try {
    await fetch(`/api/contacts/${activeContact.phone}/toggle-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    activeContact.ai_enabled = enabled ? 1 : 0;
    showToast(enabled ? 'تم تفعيل Antigravity AI لهذه المحادثة' : 'تم تحويل المحادثة للرد اليدوي');
  } catch (err) {
    showToast('فشل التحديث', true);
  }
});

// 7. Tickets Management
async function loadTickets() {
  try {
    const res = await fetch('/api/tickets');
    tickets = await res.json();
    ticketCountBadgeEl.textContent = tickets.filter(t => t.status === 'open').length;
    renderTickets();
  } catch (err) {
    console.error('Error loading tickets:', err);
  }
}

function renderTickets() {
  if (tickets.length === 0) {
    ticketsContainerEl.innerHTML = `
      <div class="p-8 text-center text-[#8696a0] text-xs">
        <i class="fa-solid fa-ticket text-2xl mb-2 opacity-30"></i>
        <p>لا توجد تذاكر دعم مفتوحة حالياً</p>
      </div>
    `;
    return;
  }

  ticketsContainerEl.innerHTML = tickets.map(t => {
    const isOpen = t.status === 'open';
    return `
      <div class="p-3 rounded-xl bg-[#202c33] border border-[#222d34] text-xs space-y-2">
        <div class="flex items-center justify-between">
          <span class="font-bold text-amber-400 font-mono text-sm">#${t.ticket_number}</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${isOpen ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-400'}">
            ${isOpen ? 'قيد المتابعة مع أحمد' : 'تم الرد'}
          </span>
        </div>
        <div>
          <p class="font-bold text-[#e9edef]">${escapeHtml(t.customer_name || t.customer_phone)}</p>
          <p class="text-[11px] text-[#8696a0] font-mono" dir="ltr">+${t.customer_phone}</p>
        </div>
        <p class="text-[#e9edef] bg-[#111b21] p-2.5 rounded-lg text-[11px] leading-relaxed">
          ${escapeHtml(t.details)}
        </p>
        ${t.admin_reply ? `
          <div class="bg-[#005c4b]/30 border-r-2 border-[#00a884] p-2 rounded text-[11px] text-[#e9edef]">
            <span class="font-bold text-[#00a884] block mb-0.5">رد الأستاذ أحمد:</span>
            "${escapeHtml(t.admin_reply)}"
          </div>
        ` : `
          <div class="flex items-center gap-1.5 pt-1">
            <input type="text" id="replyInput_${t.ticket_number}" placeholder="اكتب رد أحمد هنا..." 
                   class="flex-1 bg-[#111b21] border border-[#222d34] rounded-lg px-2.5 py-1.5 text-xs text-[#e9edef] focus:outline-none focus:border-[#00a884]">
            <button onclick="sendTicketReply('${t.ticket_number}')" 
                    class="bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] font-bold px-3 py-1.5 rounded-lg text-xs transition">
              إرسال
            </button>
          </div>
        `}
      </div>
    `;
  }).join('');
}

async function sendTicketReply(ticketNumber) {
  const input = document.getElementById(`replyInput_${ticketNumber}`);
  if (!input) return;
  const replyText = input.value.trim();
  if (!replyText) return;

  try {
    const res = await fetch(`/api/tickets/${ticketNumber}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyText })
    });
    if (res.ok) {
      showToast(`تم إرسال رد أحمد للعميل للتذكرة #${ticketNumber}`);
      loadTickets();
      loadContacts();
    } else {
      showToast('فشل إرسال الرد', true);
    }
  } catch (err) {
    showToast('خطأ أثناء الإرسال', true);
  }
}

// 8. Tabs
tabAllEl.addEventListener('click', () => {
  activeFilter = 'all';
  tabAllEl.className = 'text-xs px-3 py-1 rounded-full bg-[#202c33] text-[#00a884] font-semibold border border-[#00a884]/30';
  tabUnreadEl.className = 'text-xs px-3 py-1 rounded-full bg-[#202c33] text-[#8696a0] hover:text-[#e9edef]';
  tabTicketsEl.className = 'text-xs px-3 py-1 rounded-full bg-[#202c33] text-amber-400 border border-amber-500/30';
  ticketsDrawerEl.classList.add('hidden');
  contactsListEl.classList.remove('hidden');
  renderContacts();
});

tabUnreadEl.addEventListener('click', () => {
  activeFilter = 'unread';
  tabUnreadEl.className = 'text-xs px-3 py-1 rounded-full bg-[#202c33] text-[#00a884] font-semibold border border-[#00a884]/30';
  tabAllEl.className = 'text-xs px-3 py-1 rounded-full bg-[#202c33] text-[#8696a0] hover:text-[#e9edef]';
  tabTicketsEl.className = 'text-xs px-3 py-1 rounded-full bg-[#202c33] text-amber-400 border border-amber-500/30';
  ticketsDrawerEl.classList.add('hidden');
  contactsListEl.classList.remove('hidden');
  renderContacts(contacts.filter(c => c.unread_count > 0));
});

tabTicketsEl.addEventListener('click', () => {
  activeFilter = 'tickets';
  tabTicketsEl.className = 'text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 font-bold border border-amber-500';
  tabAllEl.className = 'text-xs px-3 py-1 rounded-full bg-[#202c33] text-[#8696a0] hover:text-[#e9edef]';
  tabUnreadEl.className = 'text-xs px-3 py-1 rounded-full bg-[#202c33] text-[#8696a0] hover:text-[#e9edef]';
  contactsListEl.classList.add('hidden');
  ticketsDrawerEl.classList.remove('hidden');
  renderTickets();
});

btnCloseTicketsDrawerEl.addEventListener('click', () => {
  tabAllEl.click();
});

// 9. Search
searchInputEl.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) {
    renderContacts();
    return;
  }
  const filtered = contacts.filter(c => 
    (c.name && c.name.toLowerCase().includes(q)) || 
    (c.phone && c.phone.includes(q)) ||
    (c.last_message && c.last_message.toLowerCase().includes(q))
  );
  renderContacts(filtered);
});

// 10. Simulators
btnQuickSimulateEl.addEventListener('click', async () => {
  aiTypingBarEl.classList.remove('hidden');

  const sampleComplaints = [
    'السلام عليكم، بدخل كلمة المرور بالمنصة وبيعطيني خطأ 403 وحسابي معلق وما بفتح الدروس',
    'مرحبا، اشتركت بالدورة وتم خصم المبلغ ولسا ما تفعل الحساب، شو الإجراء؟',
    'يعطيك العافية، بدي استفسر عن حجز موعد مع الأستاذ أحمد لمناقشة مشروع'
  ];
  const sampleNames = ['محمود قاسم', 'يزيد العبداللات', 'عمر الطراونة'];
  const rIdx = Math.floor(Math.random() * sampleComplaints.length);
  const randomPhone = '96279' + Math.floor(1000000 + Math.random() * 9000000);

  try {
    await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: randomPhone,
        name: sampleNames[rIdx],
        text: sampleComplaints[rIdx]
      })
    });

    setTimeout(async () => {
      aiTypingBarEl.classList.add('hidden');
      await loadContacts();
      await loadTickets();
      selectContact(randomPhone);
      showToast(`وصلت رسالة عميل وتم فتح تذكرة عبر Antigravity AI!`);
    }, 1200);

  } catch (err) {
    aiTypingBarEl.classList.add('hidden');
    showToast('خطأ بالمحاكاة', true);
  }
});

btnSimulateAhmadReplyEl.addEventListener('click', async () => {
  const openTicket = tickets.find(t => t.status === 'open');
  if (!openTicket) {
    showToast('لا توجد تذكرة مفتوحة حالياً لتجربة رد أحمد عليها!', true);
    return;
  }

  aiTypingBarEl.classList.remove('hidden');

  try {
    const ahmadReply = `تم فحص المشكلة وحلها وتفعيل كافة الصلاحيات بنجاح. تفضل بالدخول الآن.`;
    await fetch(`/api/tickets/${openTicket.ticket_number}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyText: ahmadReply })
    });

    setTimeout(async () => {
      aiTypingBarEl.classList.add('hidden');
      await loadTickets();
      await loadContacts();
      selectContact(openTicket.customer_phone);
      showToast(`قام الأستاذ أحمد بالرد وتم ترحيل الرد للعميل فوراً!`);
    }, 1000);

  } catch (err) {
    aiTypingBarEl.classList.add('hidden');
    showToast('خطأ أثناء محاكاة رد أحمد', true);
  }
});

// 11. Settings
btnOpenSettingsEl.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    settingPhoneIdEl.value = s.meta_phone_number_id || '';
    settingAccessTokenEl.value = s.meta_access_token || '';
    settingAiKeyEl.value = s.ai_api_key || '';
    settingsModalEl.classList.remove('hidden');
  } catch (err) {
    showToast('فشل فتح الإعدادات', true);
  }
});
btnCloseSettingsEl.addEventListener('click', () => settingsModalEl.classList.add('hidden'));

btnSaveSettingsEl.addEventListener('click', async () => {
  try {
    const payload = {
      meta_phone_number_id: settingPhoneIdEl.value.trim(),
      meta_access_token: settingAccessTokenEl.value.trim(),
      ai_api_key: settingAiKeyEl.value.trim()
    };
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('تم حفظ الإعدادات بنجاح!');
      settingsModalEl.classList.add('hidden');
    }
  } catch (err) {
    showToast('خطأ أثناء الحفظ', true);
  }
});

btnCheckMetaEl.addEventListener('click', async () => {
  btnCheckMetaEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> فحص...';
  const res = await fetch('/api/status');
  const data = await res.json();
  btnCheckMetaEl.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> فحص الاتصال بميتا';
  showToast(data.status === 'connected' ? `متصل بنجاح: ${data.phoneNumber}` : 'غير متصل أو خطأ بالمفاتيح');
});

// 12. Sockets
socket.on('new_message', ({ contact, message }) => {
  const idx = contacts.findIndex(c => c.phone === contact.phone);
  if (idx !== -1) {
    contacts[idx] = contact;
  } else {
    contacts.unshift(contact);
  }
  renderContacts();

  if (activeContact && activeContact.phone === contact.phone) {
    loadMessages(contact.phone);
  }
});

socket.on('ticket_created', () => {
  loadTickets();
  loadContacts();
});

socket.on('ticket_updated', () => {
  loadTickets();
  loadContacts();
  if (activeContact) loadMessages(activeContact.phone);
});

// Helper: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Initial Boot
loadContacts();
loadTickets();

// -------------------------------------------------------------
// Tasks & CRM Management UI (n8n Autonomous Engine)
// -------------------------------------------------------------
const tabTasksEl = document.getElementById('tabTasks');
const tabCrmEl = document.getElementById('tabCrm');
const tasksDrawerEl = document.getElementById('tasksDrawer');
const crmDrawerEl = document.getElementById('crmDrawer');
const tasksContainerEl = document.getElementById('tasksContainer');
const crmContainerEl = document.getElementById('crmContainer');
const taskCountBadgeEl = document.getElementById('taskCountBadge');
const btnCloseTasksDrawerEl = document.getElementById('btnCloseTasksDrawer');
const btnCloseCrmDrawerEl = document.getElementById('btnCloseCrmDrawer');
const btnSimulateDinnerEl = document.getElementById('btnSimulateDinner');
const btnAddCrmContactEl = document.getElementById('btnAddCrmContact');

let agentTasks = [];
let crmContacts = [];

async function loadAgentTasks() {
  try {
    const res = await fetch('/api/tasks');
    agentTasks = await res.json();
    if (taskCountBadgeEl) taskCountBadgeEl.textContent = agentTasks.filter(t => t.status === 'in_progress').length;
    renderAgentTasks();
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
}

async function loadCrmContacts() {
  try {
    const res = await fetch('/api/crm');
    crmContacts = await res.json();
    renderCrmContacts();
  } catch (err) {
    console.error('Failed to load CRM contacts:', err);
  }
}

function renderAgentTasks() {
  if (!tasksContainerEl) return;
  if (!agentTasks || agentTasks.length === 0) {
    tasksContainerEl.innerHTML = '<div class="text-center py-6 text-xs text-[#8696a0]">لا توجد مهام حالياً</div>';
    return;
  }

  tasksContainerEl.innerHTML = agentTasks.map(t => `
    <div class="p-3 bg-[#202c33] rounded-lg border border-[#2a3942] space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-emerald-400">#${t.task_code}</span>
        <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold ${t.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}">
          ${t.status === 'completed' ? '✅ مكتملة' : '⏳ جاري التنسيق'}
        </span>
      </div>
      <p class="text-xs text-[#e9edef] font-semibold">🎯 الهدف: ${t.target_name} (${t.target_phone})</p>
      <p class="text-[11px] text-[#8696a0]">📋 طلب أحمد: "${t.instruction}"</p>
      ${t.last_target_reply ? `
        <div class="p-2 bg-[#111b21] rounded text-[11px] text-emerald-300 border border-emerald-500/20">
          💬 رد ${t.target_name}: "${t.last_target_reply}"
        </div>
      ` : ''}
      <p class="text-[10px] text-[#8696a0] text-left">${t.created_at}</p>
    </div>
  `).join('');
}

function renderCrmContacts() {
  if (!crmContainerEl) return;
  if (!crmContacts || crmContacts.length === 0) {
    crmContainerEl.innerHTML = '<div class="text-center py-6 text-xs text-[#8696a0]">لا توجد جهات اتصال في الـ CRM</div>';
    return;
  }

  crmContainerEl.innerHTML = crmContacts.map(c => `
    <div class="p-2.5 bg-[#202c33] rounded-lg border border-[#2a3942] space-y-1">
      <div class="flex items-center justify-between">
        <h4 class="text-xs font-bold text-[#e9edef]">${c.full_name} ${c.nickname ? `(${c.nickname})` : ''}</h4>
        <span class="text-[10px] bg-[#53bdeb]/20 text-[#53bdeb] px-2 py-0.5 rounded font-medium">${c.relation || 'عميل'}</span>
      </div>
      <p class="text-[11px] text-[#00a884] font-mono">${c.phone}</p>
      ${c.company ? `<p class="text-[11px] text-[#8696a0]">🏢 ${c.company}</p>` : ''}
      ${c.notes ? `<p class="text-[11px] text-[#aebac1]">📝 ${c.notes}</p>` : ''}
    </div>
  `).join('');
}

// Wire up events
if (tabTasksEl) {
  tabTasksEl.addEventListener('click', () => {
    contactsListEl.classList.add('hidden');
    ticketsDrawerEl.classList.add('hidden');
    if (crmDrawerEl) crmDrawerEl.classList.add('hidden');
    tasksDrawerEl.classList.remove('hidden');
    loadAgentTasks();
  });
}

if (tabCrmEl) {
  tabCrmEl.addEventListener('click', () => {
    contactsListEl.classList.add('hidden');
    ticketsDrawerEl.classList.add('hidden');
    tasksDrawerEl.classList.add('hidden');
    if (crmDrawerEl) crmDrawerEl.classList.remove('hidden');
    loadCrmContacts();
  });
}

if (btnCloseTasksDrawerEl) {
  btnCloseTasksDrawerEl.addEventListener('click', () => {
    tasksDrawerEl.classList.add('hidden');
    contactsListEl.classList.remove('hidden');
  });
}

if (btnCloseCrmDrawerEl) {
  btnCloseCrmDrawerEl.addEventListener('click', () => {
    crmDrawerEl.classList.add('hidden');
    contactsListEl.classList.remove('hidden');
  });
}

// Add CRM contact prompt
if (btnAddCrmContactEl) {
  btnAddCrmContactEl.addEventListener('click', async () => {
    const name = prompt('أدخل الاسم الكامل:');
    if (!name) return;
    const phone = prompt('أدخل رقم الهاتف (مثال: 96279xxxxxxx):');
    if (!phone) return;
    const nickname = prompt('اللقب / الكنية (اختياري، مثلاً: أبو فلان):') || '';
    const relation = prompt('العلاقة / التصنيف (مثال: صديق، شريك، عميل VIP):') || 'عميل';
    const notes = prompt('ملاحظات خاصة (اختياري):') || '';

    try {
      await fetch('/api/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name, phone, nickname, relation, notes })
      });
      loadCrmContacts();
    } catch (e) {
      alert('فشل حفظ جهة الاتصال');
    }
  });
}

// Simulate Dinner Coordination from Dashboard Header
if (btnSimulateDinnerEl) {
  btnSimulateDinnerEl.addEventListener('click', async () => {
    alert('🚀 بدء محاكاة: أحمد العامودي يطلب من الروبوت التنسيق مع خالد سلامه للعشاء...');
    try {
      // Step 1: Ahmad sends command
      await fetch('/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object: 'whatsapp_business_account',
          entry: [{
            changes: [{
              value: {
                messaging_product: 'whatsapp',
                contacts: [{ profile: { name: 'أحمد العامودي' }, wa_id: '962782932611' }],
                messages: [{ from: '962782932611', text: { body: 'كيفك شوفلي خالد سلامه اذا ممكن انا وياه اليوم نطلع ع العشا مع بعض' }, type: 'text' }]
              }
            }]
          }]
        })
      });

      // Step 2 after 3 seconds: Khaled replies
      setTimeout(async () => {
        await fetch('/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            object: 'whatsapp_business_account',
            entry: [{
              changes: [{
                value: {
                  messaging_product: 'whatsapp',
                  contacts: [{ profile: { name: 'خالد سلامه' }, wa_id: '962791112233' }],
                  messages: [{ from: '962791112233', text: { body: 'هلا والله يا هلا، تمام موافق نلتقي اليوم الساعة 9 بكون ممتاز' }, type: 'text' }]
                }
              }]
            }]
          })
        });
        loadAgentTasks();
        loadContacts();
      }, 2500);

      loadAgentTasks();
      loadContacts();
    } catch (e) {
      console.error(e);
    }
  });
}

// Sockets updates
socket.on('task_created', () => loadAgentTasks());
socket.on('task_updated', () => loadAgentTasks());
socket.on('crm_updated', () => loadCrmContacts());

// Initial loads
loadAgentTasks();
loadCrmContacts();
