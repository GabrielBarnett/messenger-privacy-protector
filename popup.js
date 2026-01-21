document.addEventListener('DOMContentLoaded', function() {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusDiv = document.getElementById('status');
  const delayInput = document.getElementById('delay');
  const startFromInput = document.getElementById('startFrom');

  // Load saved settings
  chrome.storage.local.get(['delay', 'startFrom'], function(result) {
    if (result.delay) delayInput.value = result.delay;
    if (result.startFrom) startFromInput.value = result.startFrom;
  });

  startBtn.addEventListener('click', async function() {
    const delay = parseInt(delayInput.value) * 1000;
    const startFrom = parseInt(startFromInput.value);

    // Save settings
    chrome.storage.local.set({
      delay: delayInput.value,
      startFrom: startFromInput.value
    });

    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url || (!tab.url.includes('messenger.com'))) {
      showStatus('Please open a Messenger chat thread first', 'warning');
      return;
    }

    try {
      // Inject the content script
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });

      // Wait a moment for script to load
      await new Promise(resolve => setTimeout(resolve, 500));

      // Send message to start
      chrome.tabs.sendMessage(tab.id, {
        action: 'start',
        delay: delay,
        startFrom: startFrom
      }, function(response) {
        if (chrome.runtime.lastError) {
          showStatus('Error: ' + chrome.runtime.lastError.message, 'warning');
        }
      });

      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      showStatus('Removal started. Keep this tab open.', 'info');
    } catch (error) {
      showStatus('Error: ' + error.message, 'warning');
    }
  });

  stopBtn.addEventListener('click', async function() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    chrome.tabs.sendMessage(tab.id, {
      action: 'stop'
    });

    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    showStatus('Stopped by user', 'warning');
  });

  // Listen for status updates
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.status) {
      showStatus(request.status, request.type || 'info');
    }
    if (request.action === 'complete') {
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
    }
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
  }
});
