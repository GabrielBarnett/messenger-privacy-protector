let isRunning = false;
let shouldStop = false;
let currentThreadIdentity = null;
let navigationObserver = null;
let navigationHooksAttached = false;
let navigationListenerAttached = false;
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
      unsendMessages(request.delay);
    }
  } else if (request.action === 'stop') {
    shouldStop = true;
    isRunning = false;
  }
});

async function unsendMessages(delay) {
  console.log('Starting automatic unsend from newest to oldest');
  sendStatus('Starting...', 'info');
  
  const main = document.querySelector('[role="main"]');
  if (!main) {
    sendStatus('No conversation open', 'warning');
    isRunning = false;
    return;
  }

  currentThreadIdentity = getThreadIdentityKey();
  startNavigationWatcher(main);

  let messagesRemoved = 0;
  let attempts = 0;
  let consecutiveFailures = 0;
  let lastMessageCount = 0;
  let sameCountStreak = 0;
  let noMoreMessagesStreak = 0;
  let scrollArea = getScrollArea(main);
  let activeScrollLabel = describeScrollTarget(scrollArea);
  const scrollStep = 1200;
  const skippedMessages = new WeakSet();
  const shortWait = 150;
  const mediumWait = 300;
  const longWait = 600;

  const scrollUp = async (activeScrollArea, step, context) => {
    const initialTop = activeScrollArea.scrollTop;
    console.log(`Scrolling up${context ? ` (${context})` : ''}...`);
    activeScrollArea.scrollBy({ top: -step, behavior: 'smooth' });
    activeScrollArea.dispatchEvent(new WheelEvent('wheel', { deltaY: -step, bubbles: true }));
    await sleep(shortWait);

    if (activeScrollArea.scrollTop === initialTop) {
      activeScrollArea.scrollTop = Math.max(0, initialTop - step);
      activeScrollArea.dispatchEvent(new WheelEvent('wheel', { deltaY: -step, bubbles: true }));
      await sleep(shortWait);
    }

    if (activeScrollArea.scrollTop !== initialTop) {
      return activeScrollArea;
    }

    const oldestMessage = getOldestMessageInView(main);
    if (oldestMessage) {
      oldestMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await sleep(mediumWait);
      if (activeScrollArea.scrollTop !== initialTop) {
        return activeScrollArea;
      }
    }

    const fallback = document.scrollingElement || activeScrollArea.parentElement;
    if (!fallback || fallback === activeScrollArea) {
      return activeScrollArea;
    }

    console.log('Scroll position unchanged, retrying with fallback scroll area');
    const fallbackInitialTop = fallback.scrollTop;
    fallback.scrollBy({ top: -step, behavior: 'smooth' });
    fallback.dispatchEvent(new WheelEvent('wheel', { deltaY: -step, bubbles: true }));
    await sleep(shortWait);

    if (fallback.scrollTop === fallbackInitialTop) {
      fallback.scrollTop = Math.max(0, fallbackInitialTop - step);
      fallback.dispatchEvent(new WheelEvent('wheel', { deltaY: -step, bubbles: true }));
      await sleep(shortWait);
    }

    return fallback.scrollTop !== fallbackInitialTop ? fallback : activeScrollArea;
  };

  try {
    // First, scroll to the bottom to start with newest messages
    scrollArea.scrollTop = scrollArea.scrollHeight;
    await sleep(longWait);
    
    while (!shouldStop) {
      await sleep(mediumWait);
      
      attempts++;
      console.log(`\n=== Attempt ${attempts} ===`);
      
      // Find all message text elements
      const allMessages = getMessageElements(main);
      console.log(`Found ${allMessages.length} message text elements`);
      
      // Filter to messages on RIGHT side (yours)
      const containerRect = scrollArea.getBoundingClientRect();
      const rightThreshold = containerRect.width * 0.55;
      
      let yourMessages = allMessages.filter(msg => {
        const rect = msg.getBoundingClientRect();
        const msgCenter = rect.left + (rect.width / 2);
        const relativePosition = msgCenter - containerRect.left;
        
        return rect.width > 0 && rect.height > 0 && relativePosition > rightThreshold;
      });

      if (yourMessages.length === 0) {
        yourMessages = allMessages.filter(msg => {
          const container = msg.closest('[data-testid="message-container"], [role="row"], [data-testid="mwthreadlist-message"]');
          if (!container) {
            return false;
          }
          const label = (container.getAttribute('aria-label') || '').toLowerCase();
          return label.includes('you sent') || label.includes('you replied') || label.includes('sent by you');
        });
      }

      const usingFallbackMessages = yourMessages.length === 0 && allMessages.length > 0;
      if (usingFallbackMessages) {
        console.log('No explicit "your" messages detected; falling back to all messages.');
        yourMessages = allMessages;
      }
      
      const candidateMessages = yourMessages.filter(msg => !skippedMessages.has(msg));
      console.log(`Found ${yourMessages.length} messages on right side (yours)`);
      console.log(`Found ${candidateMessages.length} unskipped candidate messages`);
      
      // Check if we're stuck (no change in message count)
      if (yourMessages.length === lastMessageCount) {
        sameCountStreak++;
      } else {
        sameCountStreak = 0;
      }
      lastMessageCount = yourMessages.length;
      
      if (candidateMessages.length === 0) {
        consecutiveFailures++;
        console.log(`No messages found (${consecutiveFailures})`);

        // Scroll UP to load older messages
        console.log('Scrolling up to load more messages...');
        const previousHeight = scrollArea.scrollHeight;
        scrollArea = await scrollUp(scrollArea, scrollStep, 'no messages found');
        if (scrollArea !== activeScrollLabel.target) {
          activeScrollLabel = describeScrollTarget(scrollArea);
        }
        if (scrollArea.scrollTop > 0) {
          scrollArea.scrollTop = 0;
          await sleep(shortWait);
        }
        await sleep(longWait);

        const heightChanged = scrollArea.scrollHeight > previousHeight + 1;
        const atTop = scrollArea.scrollTop <= 1;
        if (atTop && !heightChanged) {
          noMoreMessagesStreak++;
          console.log(`No more messages detected (${noMoreMessagesStreak}/3)`);
        } else {
          noMoreMessagesStreak = 0;
        }

        if (noMoreMessagesStreak >= 3) {
          console.log('No more messages - done!');
          break;
        }
        continue;
      }

      consecutiveFailures = 0;
      noMoreMessagesStreak = 0;
      
      // Process a message near the bottom unless we're in fallback mode.
      const targetMessage = usingFallbackMessages
        ? candidateMessages[0]
        : candidateMessages[candidateMessages.length - 1];
      const targetText = (targetMessage.textContent || '').trim();
      const normalizedTarget = targetText.toLowerCase();

      if (normalizedTarget === 'you deleted a message' || normalizedTarget === 'you deleted a message.') {
        console.log('Skipping deleted message placeholder');
        skippedMessages.add(targetMessage);
        continue;
      }
      
      // Scroll it into view
      const scrollBlock = usingFallbackMessages ? 'start' : 'center';
      targetMessage.scrollIntoView({ behavior: 'smooth', block: scrollBlock });
      await sleep(mediumWait);
      
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
      
      await sleep(mediumWait);
      
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
          await sleep(longWait);
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
          await sleep(longWait);
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
        await sleep(mediumWait);
        skippedMessages.add(targetMessage);

        // Scroll UP to load older messages
        scrollArea = await scrollUp(scrollArea, scrollStep, 'no unsend option');
        if (scrollArea !== activeScrollLabel.target) {
          activeScrollLabel = describeScrollTarget(scrollArea);
        }
        await sleep(longWait);
        continue;
      }
      
      // Click Unsend
      console.log('Clicking Unsend...');
      unsendItem.click();
      await sleep(longWait);

      const dialogHandled = await handleUnsendDialog();
      if (dialogHandled) {
        messagesRemoved++;
        sendStatus(`Removed ${messagesRemoved} message(s)...`, 'info');
        await sleep(delay);

        const nearTop = rect.top < containerRect.top + 120;
        const lowScrollOffset = scrollArea.scrollTop <= scrollStep;

        if (nearTop || lowScrollOffset) {
          scrollArea = await scrollUp(scrollArea, scrollStep, 'after unsend');
          if (scrollArea !== activeScrollLabel.target) {
            activeScrollLabel = describeScrollTarget(scrollArea);
          }
          await sleep(mediumWait);
        } else {
          scrollArea.scrollTop = Math.max(0, scrollArea.scrollTop - 200);
          await sleep(mediumWait);
        }

        if (sameCountStreak >= 3) {
          console.log('Same message count detected, forcing scroll up');
          scrollArea = await scrollUp(scrollArea, scrollStep, 'same count streak');
          if (scrollArea !== activeScrollLabel.target) {
            activeScrollLabel = describeScrollTarget(scrollArea);
          }
          await sleep(longWait);
          sameCountStreak = 0;
        }
        continue;
      }
      
      // Click confirmation
      const buttons = document.querySelectorAll('[role="button"]');
      let confirmBtn = null;
      
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        const btnRect = btn.getBoundingClientRect();
        if ((text === 'Unsend' || text === 'Remove') && btnRect.width > 100) {
          confirmBtn = btn;
          break;
        }
      }
      
      if (!confirmBtn) {
        console.log('No confirm button');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        await sleep(mediumWait);
        continue;
      }
      
      // UNSEND!
      console.log('✓✓✓ UNSENDING ✓✓✓');
      confirmBtn.click();
      messagesRemoved++;
      
      sendStatus(`Removed ${messagesRemoved} message(s)...`, 'info');
      await sleep(delay);
      
      const nearTop = rect.top < containerRect.top + 120;
      const lowScrollOffset = scrollArea.scrollTop <= scrollStep;

      if (nearTop || lowScrollOffset) {
        scrollArea = await scrollUp(scrollArea, scrollStep, 'after unsend');
        if (scrollArea !== activeScrollLabel.target) {
          activeScrollLabel = describeScrollTarget(scrollArea);
        }
        await sleep(mediumWait);
      } else {
        // After removing a message, nudge upward to keep moving to older messages.
        scrollArea.scrollTop = Math.max(0, scrollArea.scrollTop - 200);
        await sleep(mediumWait);
      }

      if (sameCountStreak >= 3) {
        console.log('Same message count detected, forcing scroll up');
        scrollArea = await scrollUp(scrollArea, scrollStep, 'same count streak');
        if (scrollArea !== activeScrollLabel.target) {
          activeScrollLabel = describeScrollTarget(scrollArea);
        }
        await sleep(longWait);
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

function getThreadIdentityKey() {
  const path = location.pathname;
  const match = path.match(/\/t\/([^/]+)/);
  const headerLink = document.querySelector('header a[href*="/t/"], header a[href*="messenger.com/t/"]');
  const headerHref = headerLink?.getAttribute('href') || '';
  if (headerHref) {
    return headerHref;
  }
  if (match?.[1]) {
    return `/t/${match[1]}`;
  }
  return path;
}

function stopForChatChange() {
  if (shouldStop) {
    return;
  }
  shouldStop = true;
  isRunning = false;
  sendStatus('Stopped: chat changed', 'warning');
  chrome.runtime.sendMessage({ action: 'stopped', reason: 'chat changed' });
}

function handleThreadCheck() {
  if (!isRunning) {
    return;
  }
  const nextIdentity = getThreadIdentityKey();
  if (!currentThreadIdentity) {
    currentThreadIdentity = nextIdentity;
    return;
  }
  if (nextIdentity && nextIdentity !== currentThreadIdentity) {
    stopForChatChange();
    currentThreadIdentity = nextIdentity;
  }
}

function startNavigationWatcher(main) {
  if (!navigationHooksAttached) {
    attachHistoryHooks();
    navigationHooksAttached = true;
  }

  if (!navigationListenerAttached) {
    window.addEventListener('mpp:history-change', handleThreadCheck);
    navigationListenerAttached = true;
  }

  if (navigationObserver) {
    navigationObserver.disconnect();
  }

  const observerTarget = main || document.body;
  navigationObserver = new MutationObserver(() => {
    if (!isRunning) {
      return;
    }
    handleThreadCheck();
  });
  navigationObserver.observe(observerTarget, { childList: true, subtree: true });
}

function attachHistoryHooks() {
  const wrapHistoryMethod = (methodName) => {
    const original = history[methodName];
    if (original._mppWrapped) {
      return;
    }
    const wrapped = function(...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event('mpp:history-change'));
      return result;
    };
    wrapped._mppWrapped = true;
    history[methodName] = wrapped;
  };

  wrapHistoryMethod('pushState');
  wrapHistoryMethod('replaceState');
  window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('mpp:history-change'));
  });
}

function getScrollArea(main) {
  const messageSample = getMessageElements(main)[0];
  if (messageSample) {
    const scrollAncestor = findScrollableAncestor(messageSample);
    if (scrollAncestor) {
      return scrollAncestor;
    }
  }

  const candidates = [
    main.querySelector('[role="log"]'),
    main.querySelector('[aria-label="Message list"]'),
    main.querySelector('[data-testid="message-container"]')?.parentElement,
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

function findScrollableAncestor(node) {
  let current = node;
  while (current && current !== document.body) {
    if (current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function describeScrollTarget(target) {
  const labelParts = [];
  if (!target) {
    return { target: null, label: 'none' };
  }
  if (target.id) {
    labelParts.push(`#${target.id}`);
  }
  if (target.getAttribute('data-testid')) {
    labelParts.push(`[data-testid="${target.getAttribute('data-testid')}"]`);
  }
  if (target.getAttribute('role')) {
    labelParts.push(`[role="${target.getAttribute('role')}"]`);
  }
  labelParts.push(target.tagName.toLowerCase());
  const label = labelParts.join(' ');
  console.log(`Scroll target selected: ${label} (scrollHeight ${target.scrollHeight}, clientHeight ${target.clientHeight})`);
  return { target, label };
}

function getOldestMessageInView(main) {
  const messages = getMessageElements(main);
  let oldest = null;
  let oldestTop = Infinity;
  for (const msg of messages) {
    const rect = msg.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) {
      continue;
    }
    if (rect.top < oldestTop) {
      oldestTop = rect.top;
      oldest = msg;
    }
  }
  return oldest;
}

async function handleUnsendDialog() {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
  const unsendDialog = dialogs.find(dialog => {
    const text = dialog.textContent || '';
    return text.includes('Who do you want to unsend this message for?') || text.includes('Unsend for everyone');
  });

  if (!unsendDialog) {
    return false;
  }

  const optionCandidates = Array.from(unsendDialog.querySelectorAll('[role="radio"], label, div, span'))
    .filter(el => (el.textContent || '').trim() === 'Unsend for everyone');

  if (optionCandidates.length > 0) {
    const option = optionCandidates[0];
    const radio = option.closest('[role="radio"]') || option.querySelector('[role="radio"]');
    const isSelected = radio?.getAttribute('aria-checked') === 'true';
    if (!isSelected) {
      option.click();
      await sleep(300);
    }
  }

  const buttons = Array.from(unsendDialog.querySelectorAll('[role="button"], button'));
  const removeButton = buttons.find(btn => (btn.textContent || '').trim() === 'Remove');

  if (!removeButton) {
    console.log('No Remove button in unsend dialog');
    return false;
  }

  console.log('Clicking Remove in unsend dialog...');
  removeButton.click();
  await sleep(500);
  return true;
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
