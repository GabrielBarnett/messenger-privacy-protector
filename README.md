# Messenger Privacy Protector

Messenger Privacy Protector is an unpacked Chrome extension that helps you quickly unsend your messages within a selected chat. Once enabled, it streamlines message removal for the current conversation.

## Features

- Unsend your messages in a given chat.
- Simple UI for starting and stopping the process.
- Optional keyword filters to delete only matching messages or skip messages containing ignored terms.

## Installation (Unpacked Chrome Extension)

1. Clone or download this repository to your local machine.
2. Open **Google Chrome** and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the folder containing this project (the folder with `manifest.json`).
6. The extension should now appear in your extensions list.

## Usage

1. Open the chat you want to clean up in Messenger.
2. Click the extension icon to open its UI.
3. (Optional) Enable **Keyword filters** to include only messages that match your delete keywords or skip messages that contain ignored keywords.
4. Follow the on-screen prompts to start unsending messages.
5. Stop the process at any time from the extension UI.

## Notes

- This extension works as an **unpacked** Chrome extension.
- Keep the Messenger tab active while the extension is running for best results.

## Upcoming Features

- Ignore or only delete image messages.
- Save a log of everything deleted.

## Future Ideas (Not Yet Implemented)

- Export the troubleshooting log as CSV/JSON for record-keeping.
- Add message-type filters (text-only, media-only, or exclude images) to pair with keyword filters.
- Provide an ownership verification step that stops if no "sent by you" messages are detected.

## Development

- `background.js` handles extension background behavior.
- `content.js` interacts with the Messenger page.
- `ui.html` and `ui.js` provide the extension interface.

## Disclaimer

Use responsibly and in accordance with Messenger and platform policies.
