document.addEventListener('DOMContentLoaded', function() {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusDiv = document.getElementById('status');
  const delayInput = document.getElementById('delay');
  const startFromInput = document.getElementById('startFrom');

  chrome.runtime.sendMessage({ action: 'getStatus' }, function(response) {
    if (chrome.runtime.lastError) {
      showStatus('Unable to load status.', 'warning');
      return;
    }

    if (response) {
      delayInput.value = response.delay || '5';
      startFromInput.value = response.startFrom || '1';
      updateButtons(response.isRunning);
      if (response.status) {
        showStatus(response.status, response.type || 'info');
      }
    }
  });

  startBtn.addEventListener('click', function() {
    const delay = parseInt(delayInput.value, 10);
    const startFrom = parseInt(startFromInput.value, 10);

    if (Number.isNaN(delay) || delay <= 0) {
      showStatus('Please enter a valid delay.', 'warning');
      return;
    }

    chrome.runtime.sendMessage({
      action: 'start',
      delay: delay,
      startFrom: startFrom
    }, function(response) {
      if (chrome.runtime.lastError) {
        showStatus('Error: ' + chrome.runtime.lastError.message, 'warning');
        return;
      }

      if (!response?.ok) {
        showStatus(response?.error || 'Unable to start.', 'warning');
        updateButtons(false);
        return;
      }

      updateButtons(true);
      showStatus('Removal started. Keep this tab open.', 'info');
    });
  });

  stopBtn.addEventListener('click', function() {
    chrome.runtime.sendMessage({ action: 'stop' }, function() {
      if (chrome.runtime.lastError) {
        showStatus('Error: ' + chrome.runtime.lastError.message, 'warning');
        return;
      }
      updateButtons(false);
      showStatus('Stopping... Please wait for the current action to finish.', 'warning');
    });
  });

  chrome.runtime.onMessage.addListener(function(request) {
    if (request.status) {
      showStatus(request.status, request.type || 'info');
    }
    if (request.action === 'complete') {
      updateButtons(false);
    }
    if (request.action === 'stopped') {
      updateButtons(false);
    }
  });

  function updateButtons(isRunning) {
    if (isRunning) {
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
    } else {
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
    }
  }

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
  }
});
