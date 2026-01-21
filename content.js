let isRunning = false;
let shouldStop = false;
const MESSAGE_SELECTORS = [
  '[data-testid="mw-message-text"]',
  '[data-testid="message_text"]',
  '[data-testid="message-container"] [dir="auto"]',
  '[role="row"] [dir="auto"]',
  'div[dir="auto"]'
];

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'start') {
    if (!isRunning) {
      isRunning = true;
      shouldStop = false;
      unsendMessages(request.delay, request.startFrom);
    }
  } else if (request.action === 'stop') {
    shouldStop = true;
    isRunning = false;
  }
});

async function unsendMessages(delay, startFrom) {
  console.log('Starting automatic unsend from newest to oldest');
  sendStatus('Starting...', 'info');
  
  const main = document.querySelector('[role="main"]');
  if (!main) {
    sendStatus('No conversation open', 'warning');
    isRunning = false;
    return;
  }

  let messagesRemoved = 0;
  let attempts = 0;
  let consecutiveFailures = 0;
  let lastMessageCount = 0;
  let sameCountStreak = 0;
  const scrollArea = getScrollArea(main);
  const scrollStep = 1200;

  try {
    // First, scroll to the bottom to start with newest messages
    scrollArea.scrollTop = scrollArea.scrollHeight;
    await sleep(2000);
    
    while (!shouldStop) {
      await sleep(3000);
      
      attempts++;
      console.log(`\n=== Attempt ${attempts} ===`);
      
      // Find all message text elements
      const allMessages = getMessageElements(main);
      console.log(`Found ${allMessages.length} message text elements`);
      
      // Filter to messages on RIGHT side (yours)
      const containerRect = scrollArea.getBoundingClientRect();
      const rightThreshold = containerRect.width * 0.55;
      
      const yourMessages = allMessages.filter(msg => {
        const rect = msg.getBoundingClientRect();
        const msgCenter = rect.left + (rect.width / 2);
        const relativePosition = msgCenter - containerRect.left;
        
        return rect.width > 0 && rect.height > 0 && relativePosition > rightThreshold;
      });
      
      console.log(`Found ${yourMessages.length} messages on right side (yours)`);
      
      // Check if we're stuck (no change in message count)
      if (yourMessages.length === lastMessageCount) {
        sameCountStreak++;
      } else {
        sameCountStreak = 0;
      }
      lastMessageCount = yourMessages.length;
      
      // If no messages found for 3 attempts, we're done
      if (yourMessages.length === 0) {
        consecutiveFailures++;
        console.log(`No messages found (${consecutiveFailures}/3)`);
        
        if (consecutiveFailures >= 3) {
          console.log('No more messages - done!');
          break;
        }
        
        // Scroll UP to load older messages
        console.log('Scrolling up to load more messages...');
        scrollArea.scrollTop = Math.max(0, scrollArea.scrollTop - scrollStep);
        await sleep(2500);
        continue;
      }
      
      consecutiveFailures = 0;
      
      // Process the LAST message (newest/bottom-most)
      const targetMessage = yourMessages[yourMessages.length - 1];
      
      // Scroll it into view
      targetMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(1000);
      
      // Create mouse events at the message location
      const rect = targetMessage.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const mouseEvents = ['mouseover', 'mouseenter', 'mousemove'];
      for (const eventType of mouseEvents) {
        const event = new MouseEvent(eventType, {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: centerX,
          clientY: centerY
        });
        document.elementFromPoint(centerX, centerY)?.dispatchEvent(event);
      }
      
      await sleep(1000);
      
      // Look for More button near this message
      const moreButtons = document.querySelectorAll('[aria-label="More"]');
      console.log(`Found ${moreButtons.length} More buttons after hover`);
      
      let clickedMenu = false;
      
      for (const btn of moreButtons) {
        const btnRect = btn.getBoundingClientRect();
        
        // Skip sidebar buttons
        if (btn.getAttribute('aria-label').includes('options for')) {
          continue;
        }
        
        // Check if button is near our target (within 200px vertically)
        if (Math.abs(btnRect.top - rect.top) < 200 && btnRect.width > 0) {
          console.log('Found More button near target');
          btn.click();
          clickedMenu = true;
          await sleep(1500);
          break;
        }
      }
      
      if (!clickedMenu) {
        console.log('Trying direct coordinate click for More button');
        const moreButtonX = rect.right + 30;
        const moreButtonY = rect.top + (rect.height / 2);
        
        const elementAtPoint = document.elementFromPoint(moreButtonX, moreButtonY);
        
        if (elementAtPoint) {
          const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: moreButtonX,
            clientY: moreButtonY
          });
          elementAtPoint.dispatchEvent(clickEvent);
          await sleep(1500);
        }
      }
      
      // Look for Unsend in menu
      const menuItems = document.querySelectorAll('[role="menuitem"]');
      console.log(`Menu has ${menuItems.length} items`);
      
      let unsendItem = null;
      for (const item of menuItems) {
        const text = item.textContent.trim();
        console.log(`  - "${text}"`);
        if (text === 'Unsend') {
          unsendItem = item;
          break;
        }
      }
      
      if (!unsendItem) {
        console.log('No Unsend option - scrolling up to find older messages');
        document.body.click();
        await sleep(500);
        
        // Scroll UP to load older messages
        scrollArea.scrollTop = Math.max(0, scrollArea.scrollTop - scrollStep);
        await sleep(2500);
        continue;
      }
      
      // Click Unsend
      console.log('Clicking Unsend...');
      unsendItem.click();
      await sleep(1500);
      
      // Click confirmation
      const buttons = document.querySelectorAll('[role="button"]');
      let confirmBtn = null;
      
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        const btnRect = btn.getBoundingClientRect();
        if (text === 'Unsend' && btnRect.width > 100) {
          confirmBtn = btn;
          break;
        }
      }
      
      if (!confirmBtn) {
        console.log('No confirm button');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        await sleep(500);
        continue;
      }
      
      // UNSEND!
      console.log('✓✓✓ UNSENDING ✓✓✓');
      confirmBtn.click();
      messagesRemoved++;
      
      sendStatus(`Removed ${messagesRemoved} message(s)...`, 'info');
      await sleep(delay);
      
      // After removing a message, scroll down a bit to see if more are visible
      // This helps us continue removing from newest to oldest
      scrollArea.scrollTop = Math.min(scrollArea.scrollHeight, scrollArea.scrollTop + 120);
      await sleep(500);

      if (sameCountStreak >= 3) {
        console.log('Same message count detected, forcing scroll up');
        scrollArea.scrollTop = Math.max(0, scrollArea.scrollTop - scrollStep);
        await sleep(2000);
        sameCountStreak = 0;
      }
    }
    
    sendStatus(`Complete! Removed ${messagesRemoved} message(s).`, 'success');
    chrome.runtime.sendMessage({ action: 'complete' });
    
  } catch (error) {
    console.error('Error:', error);
    sendStatus(`Error: ${error.message}`, 'warning');
  }
  
  isRunning = false;
  console.log(`\n=== DONE: ${messagesRemoved} removed ===`);
}

function sendStatus(message, type) {
  chrome.runtime.sendMessage({ status: message, type: type });
}

function getScrollArea(main) {
  const candidates = [
    main.querySelector('[role="log"]'),
    main.querySelector('[data-testid="mwthreadlist"]'),
    main.querySelector('[aria-label="Message list"]'),
    main
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.scrollHeight > candidate.clientHeight) {
      return candidate;
    }
  }

  const scrollable = Array.from(main.querySelectorAll('div')).find(el => {
    const style = window.getComputedStyle(el);
    return style.overflowY !== 'hidden' && el.scrollHeight > el.clientHeight;
  });

  return scrollable || document.scrollingElement || main;
}

function getMessageElements(main) {
  const elements = new Set();
  for (const selector of MESSAGE_SELECTORS) {
    main.querySelectorAll(selector).forEach(el => elements.add(el));
  }

  return Array.from(elements).filter(el => {
    if (!el.textContent.trim()) {
      return false;
    }
    if (el.closest('[role="textbox"]')) {
      return false;
    }
    if (el.closest('[data-testid="composer"]')) {
      return false;
    }
    return true;
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('Messenger Privacy Protector ready');
