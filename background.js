const STATUS_KEY = 'statusMessage';
const STATUS_TYPE_KEY = 'statusType';
const RUNNING_KEY = 'isRunning';
const TAB_ID_KEY = 'currentTabId';
const DELAY_KEY = 'delay';
const UI_WINDOW_ID_KEY = 'uiWindowId';
const KEYWORD_FILTERS_ENABLED_KEY = 'keywordFiltersEnabled';
const DELETE_KEYWORDS_KEY = 'deleteKeywords';
const IGNORE_KEYWORDS_KEY = 'ignoreKeywords';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([
    RUNNING_KEY,
    STATUS_KEY,
    STATUS_TYPE_KEY,
    KEYWORD_FILTERS_ENABLED_KEY,
    DELETE_KEYWORDS_KEY,
    IGNORE_KEYWORDS_KEY
  ], (result) => {
    const updates = {};
    if (result[RUNNING_KEY] === undefined) {
      updates[RUNNING_KEY] = false;
    }
    if (!result[STATUS_KEY]) {
      updates[STATUS_KEY] = 'Ready to remove messages.';
    }
    if (!result[STATUS_TYPE_KEY]) {
      updates[STATUS_TYPE_KEY] = 'info';
    }
    if (result[KEYWORD_FILTERS_ENABLED_KEY] === undefined) {
      updates[KEYWORD_FILTERS_ENABLED_KEY] = false;
    }
    if (result[DELETE_KEYWORDS_KEY] === undefined) {
      updates[DELETE_KEYWORDS_KEY] = '';
    }
    if (result[IGNORE_KEYWORDS_KEY] === undefined) {
      updates[IGNORE_KEYWORDS_KEY] = '';
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
});

chrome.action.onClicked.addListener(async () => {
  const stored = await chrome.storage.local.get([UI_WINDOW_ID_KEY]);
  const existingWindowId = stored[UI_WINDOW_ID_KEY];

  if (existingWindowId) {
    try {
      await chrome.windows.get(existingWindowId);
      await chrome.windows.update(existingWindowId, { focused: true });
      return;
    } catch (error) {
      chrome.storage.local.remove(UI_WINDOW_ID_KEY);
    }
  }

  const created = await chrome.windows.create({
    url: chrome.runtime.getURL('ui.html'),
    type: 'popup',
    width: 380,
    height: 560
  });

  if (created?.id) {
    chrome.storage.local.set({ [UI_WINDOW_ID_KEY]: created.id });
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get([UI_WINDOW_ID_KEY], (stored) => {
    if (stored[UI_WINDOW_ID_KEY] === windowId) {
      chrome.storage.local.remove(UI_WINDOW_ID_KEY);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get([TAB_ID_KEY, RUNNING_KEY], (stored) => {
    if (stored[TAB_ID_KEY] === tabId) {
      chrome.storage.local.set({
        [TAB_ID_KEY]: null,
        [RUNNING_KEY]: false,
        [STATUS_KEY]: 'Target tab closed. Ready to start again.',
        [STATUS_TYPE_KEY]: 'warning'
      });
      chrome.runtime.sendMessage({
        status: 'Target tab closed. Ready to start again.',
        type: 'warning'
      });
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStatus') {
    chrome.storage.local.get(
      [
        RUNNING_KEY,
        TAB_ID_KEY,
        STATUS_KEY,
        STATUS_TYPE_KEY,
        DELAY_KEY,
        KEYWORD_FILTERS_ENABLED_KEY,
        DELETE_KEYWORDS_KEY,
        IGNORE_KEYWORDS_KEY
      ],
      (stored) => {
        sendResponse({
          isRunning: stored[RUNNING_KEY] || false,
          currentTabId: stored[TAB_ID_KEY] || null,
          status: stored[STATUS_KEY] || '',
          type: stored[STATUS_TYPE_KEY] || 'info',
          delay: stored[DELAY_KEY] || '5',
          keywordFiltersEnabled: stored[KEYWORD_FILTERS_ENABLED_KEY] || false,
          deleteKeywords: stored[DELETE_KEYWORDS_KEY] || '',
          ignoreKeywords: stored[IGNORE_KEYWORDS_KEY] || ''
        });
      }
    );
    return true;
  }

  if (request.action === 'start') {
    handleStart(request, sendResponse);
    return true;
  }

  if (request.action === 'stop') {
    handleStop(sendResponse);
    return true;
  }

  if (request.status) {
    const statusType = request.type || 'info';
    updateStatus(request.status, statusType);

    if (!sender?.tab?.id) {
      chrome.runtime.sendMessage({ status: request.status, type: statusType });
    }
    return false;
  }

  if (request.action === 'stopped') {
    const stoppedStatus = request.status || 'Stopped: chat changed';
    chrome.storage.local.set({
      [RUNNING_KEY]: false,
      [STATUS_KEY]: stoppedStatus,
      [STATUS_TYPE_KEY]: 'warning'
    });
    chrome.runtime.sendMessage({
      action: 'stopped',
      status: stoppedStatus,
      type: 'warning'
    });
    return false;
  }

  if (request.action === 'complete') {
    chrome.storage.local.set({
      [RUNNING_KEY]: false,
      [STATUS_KEY]: 'Complete! All messages removed.',
      [STATUS_TYPE_KEY]: 'success'
    });
    chrome.runtime.sendMessage({
      action: 'complete',
      status: 'Complete! All messages removed.',
      type: 'success'
    });
  }
});

async function handleStart(request, sendResponse) {
  const stored = await chrome.storage.local.get([RUNNING_KEY]);
  if (stored[RUNNING_KEY]) {
    sendResponse({ ok: false, error: 'Already running.' });
    return;
  }

  const delayMs = parseInt(request.delay, 10);
  if (Number.isNaN(delayMs) || delayMs < 0) {
    sendResponse({ ok: false, error: 'Please enter a valid delay.' });
    return;
  }

  const tab = await findMessengerTab();
  if (!tab) {
    sendResponse({ ok: false, error: 'Please open a Messenger chat thread first.' });
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    chrome.tabs.sendMessage(tab.id, {
      action: 'start',
      delay: delayMs,
      keywordFiltersEnabled: request.keywordFiltersEnabled,
      deleteKeywords: request.deleteKeywords,
      ignoreKeywords: request.ignoreKeywords
    });

    await chrome.storage.local.set({
      [RUNNING_KEY]: true,
      [TAB_ID_KEY]: tab.id,
      [STATUS_KEY]: 'Removal started. Keep this tab open.',
      [STATUS_TYPE_KEY]: 'info',
      [DELAY_KEY]: String(request.delay),
      [KEYWORD_FILTERS_ENABLED_KEY]: Boolean(request.keywordFiltersEnabled),
      [DELETE_KEYWORDS_KEY]: request.deleteKeywords || '',
      [IGNORE_KEYWORDS_KEY]: request.ignoreKeywords || ''
    });

    chrome.runtime.sendMessage({
      status: 'Removal started. Keep this tab open.',
      type: 'info'
    });

    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
}

async function handleStop(sendResponse) {
  const stored = await chrome.storage.local.get([TAB_ID_KEY]);
  const tabId = stored[TAB_ID_KEY];

  if (tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'stop' });
  }

  await chrome.storage.local.set({
    [RUNNING_KEY]: false,
    [STATUS_KEY]: 'Stopping... Please wait for the current action to finish.',
    [STATUS_TYPE_KEY]: 'warning'
  });

  chrome.runtime.sendMessage({
    status: 'Stopping... Please wait for the current action to finish.',
    type: 'warning'
  });

  sendResponse({ ok: true });
}

async function findMessengerTab() {
  const activeTabs = await chrome.tabs.query({ active: true });
  const activeMessenger = activeTabs.find((tab) => isMessengerUrl(tab.url));
  if (activeMessenger) {
    return activeMessenger;
  }

  const messengerTabs = await chrome.tabs.query({
    url: ['https://www.messenger.com/*', 'https://messenger.com/*']
  });
  return messengerTabs[0] || null;
}

function isMessengerUrl(url) {
  if (!url) {
    return false;
  }
  return url.includes('messenger.com');
}

function updateStatus(message, type) {
  chrome.storage.local.set({
    [STATUS_KEY]: message,
    [STATUS_TYPE_KEY]: type
  });
}
