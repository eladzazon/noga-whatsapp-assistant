# 🏠 נוגה (Noga) - WhatsApp AI Home Assistant

A modular, Dockerized home assistant accessible via WhatsApp, powered by Google Gemini with Hebrew/English support.

<img width="1248" height="665" alt="image" src="https://github.com/user-attachments/assets/8471b966-f68f-4b06-982a-e2bd0d2ed57e" />

## ✨ Features

- **WhatsApp Integration** - Chat with your home assistant via WhatsApp (text & voice/audio messages).
- **Gemini AI** - Powered by Google's Gemini. Choose your preferred model from fast **2.5 Flash** to advanced **3.5 Flash** and **Pro** models directly from the dashboard!
- **Home Assistant via MCP** - Seamlessly connects to your smart home using the official Model Context Protocol (MCP) Server Add-on. Control devices and check sensors with custom Hebrew nicknames.
- **Smart Reminders** - Set reminders that automatically nudge you until you mark them done (with auto-cancellation after max nudges).
- **Google Calendar & Tasks** - View, add, and manage calendar events and shared shopping lists.
- **Dynamic Knowledge Base** - Teach Noga new facts or skills instantly by simply editing Markdown (`.md`) files.
- **Full Backup & Restore** - Complete automated and manual backup capabilities, capturing your knowledge base, database, reminders, and settings.
- **Remote Admin Commands** - Manage Noga directly from WhatsApp with commands like `/backup`, `/status`, `/restart`, and `/log`.
- **Admin Dashboard** - A beautiful web-based control panel to manage settings, mappings, schedules, test chat, and view live QR authentication.
- **Camera Snapshot Integration** - Send camera snapshots directly to your WhatsApp group via Home Assistant automations.
- **AI Quota Handling** - Graceful handling of Gemini Free Tier API limits with automatic pause/resume.
- **Hebrew Support** - Native Hebrew language support (RTL).

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (LTS)
- Docker & Docker Compose (for containerized deployment)
- Google Cloud project with Calendar & Tasks API enabled
- Home Assistant instance with the official **MCP Server Add-on** installed.

### 1. Clone and Setup

```bash
cd noga-whatsapp-assistant
cp .env.example .env
```

### 2. Configure Environment

Edit `.env` with your credentials:

```env
# Dashboard
DASHBOARD_PORT=3000
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=your-secure-password
SESSION_SECRET=random-string-here

# WhatsApp - Add your phone numbers (country code without +)
WHATSAPP_WHITELIST=972501234567,972509876543
WHATSAPP_GROUP_ID=1234567890@g.us
ADMIN_PHONE=972501234567

# Gemini AI
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash # or gemini-3.5-flash, gemini-pro, etc.

# Google APIs (see setup guide below)
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials/service-account.json
GOOGLE_OAUTH_CLIENT_ID=your-oauth-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_OAUTH_REFRESH_TOKEN=your-refresh-token

# Home Assistant (For webhook notifications)
HOME_ASSISTANT_URL=http://your-ha-instance:8123
HOME_ASSISTANT_TOKEN=your-long-lived-token
WEBHOOK_SECRET=your-secure-webhook-secret
```

### 3. Run with Docker Compose (Recommended)

Make sure you have a `docker-compose.yml` file (you can use the one from the repository) and run:

```bash
docker-compose up -d
```

### 4. Connect WhatsApp

1. Open the dashboard at `http://localhost:3000`
2. Login with your dashboard credentials
3. Scan the QR code with WhatsApp (Linked Devices)

## 📱 Usage Examples

### Smart Home & MCP
Noga uses the Model Context Protocol to dynamically understand what your Home Assistant can do!
- "תדליקי אור בסלון" (Turn on the living room light)
- "מה הטמפרטורה בחדר?" (What's the room temperature?)
- "האם דלת הכניסה נעולה?" (Is the front door locked?)

### Calendar & Reminders
- "תזכירי לי מחר ב-8 בבוקר להוציא את הפח" (Remind me tomorrow at 8am to take out the trash)
- "מה יש לי היום?" (What's on my calendar today?)

### Voice Messages & Images
- Send a voice note in Hebrew - Gemini will transcribe and process it!
- Have Home Assistant send an image payload via the webhook API and Noga will forward it to WhatsApp.

### Remote Admin Commands
Text Noga from your admin phone:
- `/help` - List all commands
- `/status` - Check WhatsApp, HA, and Gemini connection health
- `/backup` - Generate and receive a system backup right in WhatsApp
- `/restart` - Safely restart the assistant

## 🔧 Google API Setup

### Service Account (for Calendar)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the **Google Calendar API**
4. Go to **IAM & Admin** → **Service Accounts**
5. Create a service account and download the JSON key file
6. Save it as `credentials/service-account.json`
7. **Share your calendar** with the service account email

### OAuth2 (for Tasks)
1. In Google Cloud Console, go to **APIs & Services** → **Credentials**
2. Create **OAuth 2.0 Client ID** (Desktop app)
3. Use the [OAuth Playground](https://developers.google.com/oauthplayground/) to get a refresh token:
   - Authorize `https://www.googleapis.com/auth/tasks`
   - Exchange for refresh token
4. Add credentials to `.env`

## 🏗️ Knowledge & Skills Engine
Noga is dynamic! Drop Markdown files (`.md`) into the `data/knowledge/` or `data/skills/` directories, and she instantly learns them without a restart. Use the Dashboard to edit these easily.

## 🏠 Home Assistant Webhook Integration

You can trigger Noga from Home Assistant automations to send AI-composed announcements to your family group.

1. Add `WEBHOOK_SECRET` to your `.env` file (choose a strong password).
2. In `configuration.yaml` (Home Assistant), add a rest_command:

```yaml
rest_command:
  noga_notify:
    url: "http://YOUR_NOGA_IP:3000/api/notify"
    method: POST
    headers:
      x-webhook-secret: "YOUR_WEBHOOK_SECRET"
    content_type:  'application/json; charset=utf-8'
    payload: '{"event": "{{ event }}", "data": {{ data | default({}) | to_json }} }'
```

3. Use it in automations:

```yaml
action:
  - service: rest_command.noga_notify
    data:
      event: "Dryer Finished"
      data:
        location: "Laundry Room"
```

Noga will receive this and say something like: *"Attention everyone! The dryer just finished in the laundry room 🧺. Who wants to be a hero and take it out? 😎"*

## 🐳 Docker Configuration

The project automatically builds and pushes the image `eladzazon/noga-whatsapp-assistant:latest` to Docker Hub upon changes to the `main` branch via GitHub Actions.

The Docker setup includes:
- Alpine-based Node.js image with Chromium installed for WhatsApp Web execution
- Persistent volume for SQLite database
- Non-root user for security

## 🤝 Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License
MIT License - feel free to use and modify!

---

Made with ❤️ for Israeli smart homes 🇮🇱
