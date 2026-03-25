// ByzBot Widget - Embeddable AI Chatbot
// Add this script to any page: <script src="byzbot-widget.js"></script>

(function() {
  'use strict';

  // ==================== CONFIGURATION ====================
  let OPENAI_API_KEY = localStorage.getItem('byzbot-api-key') || '';
  const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

  const BYZ_CONTEXT = `You are ByzBot, a helpful and friendly AI assistant for BYZ in the Hood, an entertainment company that creates unforgettable experiences through exclusive parties, legendary events, and vibrant community gatherings in Dar es Salaam, Tanzania.

Key Information:
- BYZ hosts two main event series: Groove and Tempo
- Events take place in Dar es Salaam, Tanzania
- They have memory galleries showcasing photos from past events
- Booking is done through their website booking pages
- They're known for creating amazing party experiences with great music and atmosphere

Be conversational, helpful, and enthusiastic about BYZ events. If asked about something you don't know, politely suggest they check the website or contact BYZ directly.`;

  // ==================== STATE ====================
  let conversationHistory = [];
  let isProcessing = false;
  let isOpen = false;
  let widgetInitialized = false;

  // ==================== CREATE WIDGET ====================
  function createWidget() {
    if (widgetInitialized) return;
    widgetInitialized = true;

    // Get theme from page
    const pageTheme = document.documentElement.getAttribute('data-theme') || 'light';
    
    const widgetHTML = `
      <style>
        :root {
          --byzbot-bg: ${pageTheme === 'dark' ? '#0b0b0c' : '#ffffff'};
          --byzbot-bg-alt: ${pageTheme === 'dark' ? '#1c1c1e' : '#f5f5f7'};
          --byzbot-text: ${pageTheme === 'dark' ? '#f5f5f7' : '#1d1d1f'};
          --byzbot-sub: ${pageTheme === 'dark' ? '#a1a1a6' : '#6e6e73'};
          --byzbot-border: ${pageTheme === 'dark' ? '#2c2c2e' : '#d2d2d7'};
          --byzbot-accent: ${pageTheme === 'dark' ? '#ffffff' : '#000000'};
          --byzbot-shadow: ${pageTheme === 'dark' ? '0 18px 60px rgba(0,0,0,.35)' : '0 18px 60px rgba(0,0,0,.08)'};
        }

        #byzbot-widget {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 10000;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
        }

        .byzbot-toggle {
          width: 64px;
          height: 64px;
          border-radius: 32px;
          background: var(--byzbot-accent);
          color: var(--byzbot-bg);
          border: none;
          box-shadow: var(--byzbot-shadow);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          transition: all 0.3s cubic-bezier(.2,.8,.2,1);
          position: relative;
        }

        .byzbot-toggle:hover {
          transform: scale(1.1);
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        }

        .byzbot-container {
          position: absolute;
          bottom: 80px;
          right: 0;
          width: 380px;
          height: 600px;
          background: var(--byzbot-bg);
          border-radius: 28px;
          box-shadow: var(--byzbot-shadow);
          border: 1px solid var(--byzbot-border);
          display: none;
          flex-direction: column;
          overflow: hidden;
          animation: byzbotSlideUp 0.3s cubic-bezier(.2,.8,.2,1);
        }

        .byzbot-container.open {
          display: flex;
        }

        @keyframes byzbotSlideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .byzbot-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--byzbot-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(255,255,255,0.86);
          backdrop-filter: blur(18px);
        }

        [data-theme="dark"] .byzbot-header {
          background: rgba(0,0,0,0.86);
        }

        .byzbot-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .byzbot-avatar {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          background: linear-gradient(135deg, var(--byzbot-accent), rgba(0,0,0,0.2));
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--byzbot-bg);
          font-size: 16px;
        }

        .byzbot-header-info h3 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 2px;
          color: var(--byzbot-text);
        }

        .byzbot-header-info .status {
          font-size: 11px;
          color: var(--byzbot-sub);
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #34C759;
        }

        .byzbot-close {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid var(--byzbot-border);
          background: var(--byzbot-bg);
          color: var(--byzbot-text);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s cubic-bezier(.2,.8,.2,1);
          font-size: 12px;
        }

        .byzbot-close:hover {
          background: var(--byzbot-bg-alt);
        }

        .byzbot-messages {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          background: var(--byzbot-bg);
        }

        .byzbot-messages::-webkit-scrollbar {
          width: 4px;
        }

        .byzbot-messages::-webkit-scrollbar-thumb {
          background: var(--byzbot-border);
          border-radius: 2px;
        }

        .byzbot-message {
          display: flex;
          gap: 10px;
          animation: byzbotFadeIn 0.3s cubic-bezier(.2,.8,.2,1);
          max-width: 80%;
        }

        .byzbot-message.user {
          align-self: flex-end;
          flex-direction: row-reverse;
        }

        @keyframes byzbotFadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .byzbot-message-avatar {
          width: 28px;
          height: 28px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          flex-shrink: 0;
        }

        .byzbot-message.bot .byzbot-message-avatar {
          background: var(--byzbot-bg-alt);
          color: var(--byzbot-text);
          border: 1px solid var(--byzbot-border);
        }

        .byzbot-message.user .byzbot-message-avatar {
          background: var(--byzbot-accent);
          color: var(--byzbot-bg);
        }

        .byzbot-message-content {
          padding: 10px 14px;
          border-radius: 16px;
          font-size: 13px;
          line-height: 1.5;
          word-wrap: break-word;
          color: var(--byzbot-text);
        }

        .byzbot-message.bot .byzbot-message-content {
          background: var(--byzbot-bg-alt);
          border-bottom-left-radius: 4px;
          border: 1px solid var(--byzbot-border);
        }

        .byzbot-message.user .byzbot-message-content {
          background: var(--byzbot-accent);
          color: var(--byzbot-bg);
          border-bottom-right-radius: 4px;
        }

        .byzbot-typing {
          display: flex;
          gap: 4px;
          padding: 10px 14px;
          background: var(--byzbot-bg-alt);
          border-radius: 16px;
          border-bottom-left-radius: 4px;
          border: 1px solid var(--byzbot-border);
          width: fit-content;
        }

        .typing-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--byzbot-sub);
          animation: byzbotTyping 1.4s infinite;
        }

        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes byzbotTyping {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.7; }
          30% { transform: translateY(-8px); opacity: 1; }
        }

        .byzbot-input {
          padding: 16px 20px;
          border-top: 1px solid var(--byzbot-border);
          background: rgba(255,255,255,0.86);
          backdrop-filter: blur(18px);
        }

        [data-theme="dark"] .byzbot-input {
          background: rgba(0,0,0,0.86);
        }

        .byzbot-input-wrapper {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .byzbot-input-wrapper input {
          flex: 1;
          padding: 10px 16px;
          border: 1px solid var(--byzbot-border);
          border-radius: 20px;
          background: var(--byzbot-bg);
          color: var(--byzbot-text);
          font-size: 13px;
          font-family: inherit;
          outline: none;
          transition: all 0.2s cubic-bezier(.2,.8,.2,1);
        }

        .byzbot-input-wrapper input:focus {
          border-color: var(--byzbot-accent);
          box-shadow: 0 0 0 3px rgba(0,0,0,0.1);
        }

        .byzbot-send {
          width: 36px;
          height: 36px;
          border-radius: 18px;
          background: var(--byzbot-accent);
          color: var(--byzbot-bg);
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s cubic-bezier(.2,.8,.2,1);
          font-size: 14px;
        }

        .byzbot-send:hover {
          transform: scale(1.05);
        }

        .byzbot-send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .byzbot-welcome {
          text-align: center;
          padding: 24px 20px;
          color: var(--byzbot-sub);
          font-size: 13px;
        }

        .byzbot-welcome h4 {
          font-size: 16px;
          font-weight: 600;
          color: var(--byzbot-text);
          margin-bottom: 6px;
        }

        .byzbot-api-setup {
          padding: 20px;
          background: var(--byzbot-bg-alt);
          border: 1px solid var(--byzbot-border);
          border-radius: 12px;
          margin: 20px;
          text-align: center;
        }

        .byzbot-api-setup h4 {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 8px;
          color: var(--byzbot-text);
        }

        .byzbot-api-setup input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--byzbot-border);
          border-radius: 8px;
          background: var(--byzbot-bg);
          color: var(--byzbot-text);
          font-size: 12px;
          font-family: 'SF Mono', Monaco, monospace;
          margin-bottom: 10px;
          outline: none;
        }

        .byzbot-api-setup button {
          padding: 8px 16px;
          background: var(--byzbot-accent);
          color: var(--byzbot-bg);
          border: none;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        @media (max-width: 480px) {
          #byzbot-widget {
            bottom: 16px;
            right: 16px;
          }
          .byzbot-container {
            width: calc(100vw - 32px);
            height: calc(100vh - 100px);
            right: -16px;
          }
        }
      </style>
      <div id="byzbot-widget">
        <button class="byzbot-toggle" id="byzbotToggle">
          <i class="fas fa-robot"></i>
        </button>
        
        <div class="byzbot-container" id="byzbotContainer">
          <div class="byzbot-header">
            <div class="byzbot-header-left">
              <div class="byzbot-avatar">
                <i class="fas fa-robot"></i>
              </div>
              <div class="byzbot-header-info">
                <h3>ByzBot</h3>
                <div class="status">
                  <span class="status-dot"></span>
                  <span>Online</span>
                </div>
              </div>
            </div>
            <button class="byzbot-close" id="byzbotClose">
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="byzbot-messages" id="byzbotMessages">
            <div class="byzbot-welcome">
              <h4>👋 Hi! I'm ByzBot</h4>
              <p>Ask me anything about BYZ events, bookings, or more!</p>
            </div>
          </div>

          <div class="byzbot-input">
            <div class="byzbot-input-wrapper">
              <input 
                type="text" 
                id="byzbotInput" 
                placeholder="Type your message..."
                autocomplete="off"
              >
              <button class="byzbot-send" id="byzbotSend">
                <i class="fas fa-paper-plane"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Inject widget into page
    const widgetDiv = document.createElement('div');
    widgetDiv.innerHTML = widgetHTML;
    document.body.appendChild(widgetDiv);

    // Load Font Awesome if not already loaded
    if (!document.querySelector('link[href*="font-awesome"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
      document.head.appendChild(link);
    }

    // ==================== DOM ELEMENTS ====================
    const toggle = document.getElementById('byzbotToggle');
    const container = document.getElementById('byzbotContainer');
    const closeBtn = document.getElementById('byzbotClose');
    const messages = document.getElementById('byzbotMessages');
    const input = document.getElementById('byzbotInput');
    const sendBtn = document.getElementById('byzbotSend');

    // Check for API key
    if (!OPENAI_API_KEY) {
      const apiSetup = document.createElement('div');
      apiSetup.className = 'byzbot-api-setup';
      apiSetup.innerHTML = `
        <h4>🔑 API Key Required</h4>
        <input type="password" id="byzbotApiKey" placeholder="Enter OpenAI API key (sk-...)" />
        <button id="byzbotSaveKey">Save</button>
        <p style="margin-top: 8px; font-size: 11px; color: var(--byzbot-sub);">
          <a href="https://platform.openai.com/api-keys" target="_blank" style="color: var(--byzbot-accent);">
            Get API key →
          </a>
        </p>
      `;
      messages.innerHTML = '';
      messages.appendChild(apiSetup);
      
      document.getElementById('byzbotSaveKey').addEventListener('click', () => {
        const key = document.getElementById('byzbotApiKey').value.trim();
        if (key && key.startsWith('sk-')) {
          OPENAI_API_KEY = key;
          localStorage.setItem('byzbot-api-key', key);
          apiSetup.remove();
          messages.innerHTML = `
            <div class="byzbot-welcome">
              <h4>👋 Hi! I'm ByzBot</h4>
              <p>Ask me anything about BYZ events, bookings, or more!</p>
            </div>
          `;
        }
      });
    }

    // ==================== TOGGLE ====================
    toggle.addEventListener('click', () => {
      isOpen = !isOpen;
      container.classList.toggle('open', isOpen);
      if (isOpen) input.focus();
    });

    closeBtn.addEventListener('click', () => {
      isOpen = false;
      container.classList.remove('open');
    });

    // ==================== MESSAGES ====================
    function addMessage(content, isUser = false) {
      const msg = document.createElement('div');
      msg.className = `byzbot-message ${isUser ? 'user' : 'bot'}`;
      
      const avatar = document.createElement('div');
      avatar.className = 'byzbot-message-avatar';
      avatar.innerHTML = isUser ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'byzbot-message-content';
      contentDiv.textContent = content;
      
      msg.appendChild(avatar);
      msg.appendChild(contentDiv);
      messages.appendChild(msg);
      
      const welcome = messages.querySelector('.byzbot-welcome');
      if (welcome) welcome.remove();
      
      scrollToBottom();
    }

    function showTyping() {
      const typing = document.createElement('div');
      typing.className = 'byzbot-message bot';
      typing.id = 'typing-indicator';
      typing.innerHTML = `
        <div class="byzbot-message-avatar"><i class="fas fa-robot"></i></div>
        <div class="byzbot-typing">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      `;
      messages.appendChild(typing);
      scrollToBottom();
    }

    function removeTyping() {
      const typing = document.getElementById('typing-indicator');
      if (typing) typing.remove();
    }

    // ==================== API ====================
    async function getAIResponse(userMessage) {
      if (!OPENAI_API_KEY) {
        throw new Error('OpenAI API key not configured');
      }

      conversationHistory.push({ role: 'user', content: userMessage });

      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: BYZ_CONTEXT },
            ...conversationHistory.slice(-10)
          ],
          temperature: 0.7,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'API error');
      }

      const data = await response.json();
      const aiMessage = data.choices[0].message.content;
      conversationHistory.push({ role: 'assistant', content: aiMessage });
      return aiMessage;
    }

    // ==================== HANDLERS ====================
    async function handleMessage() {
      const message = input.value.trim();
      if (!message || isProcessing || !OPENAI_API_KEY) return;

      addMessage(message, true);
      input.value = '';
      input.disabled = true;
      sendBtn.disabled = true;
      isProcessing = true;
      showTyping();

      try {
        const response = await getAIResponse(message);
        removeTyping();
        addMessage(response, false);
      } catch (error) {
        removeTyping();
        addMessage('Sorry, I encountered an error. Please check your API key and try again.', false);
        console.error('ByzBot Error:', error);
      } finally {
        input.disabled = false;
        sendBtn.disabled = false;
        isProcessing = false;
        input.focus();
      }
    }

    sendBtn.addEventListener('click', handleMessage);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !isProcessing) {
        e.preventDefault();
        handleMessage();
      }
    });

    function scrollToBottom() {
      messages.scrollTop = messages.scrollHeight;
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();

