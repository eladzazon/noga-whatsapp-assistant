# 🏠 נוגה (Noga) - WhatsApp AI Home Assistant

A modular, Dockerized home assistant accessible via WhatsApp, powered by Google Gemini with Hebrew/English support.

<img width="1248" height="665" alt="image" src="https://github.com/user-attachments/assets/8471b966-f68f-4b06-982a-e2bd0d2ed57e" />



## ✨ Features

- **WhatsApp Integration** - Chat with your home assistant via WhatsApp (text & voice)
- **Gemini AI** - Powered by Google's Gemini with function calling
- **Google Calendar** - View, add, and manage calendar events
- **Shopping List** - Manage a shared shopping list via Google Tasks
- **Home Assistant** - Control smart home devices and check sensors with custom Hebrew nicknames and location mapping
- **AI Quota Handling** - Graceful handling of Gemini API limits with dashboard alerts and user notifications
- **Admin Dashboard** - Web-based control panel with live QR code, logs, and entity mapping interface
- **Hebrew Support** - Native Hebrew language support (RTL)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (LTS)
- Docker & Docker Compose (for containerized deployment)
- Google Cloud project with Calendar & Tasks API enabled
- Home Assistant instance (optional)

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

# Gemini AI
GEMINI_API_KEY=your-gemini-api-key

# Google APIs (see setup guide below)
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials/service-account.json
GOOGLE_OAUTH_CLIENT_ID=your-oauth-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_OAUTH_REFRESH_TOKEN=your-refresh-token

# Home Assistant
HOME_ASSISTANT_URL=http://your-ha-instance:8123
HOME_ASSISTANT_TOKEN=your-long-lived-token
```

### 3. Run with Docker Compose (Recommended)

Make sure you have a `docker-compose.yml` file (you can use the one from the repository) and run:

```bash
docker-compose up -d
```

### 4. Run with Docker (Standalone)

If you just want to run the pre-built image from Docker Hub quickly:

```bash
docker run -d \
  --name noga-assistant \
  --restart unless-stopped \
  -p 3000:3000 \
  -v noga-data:/app/data \
  -v ./credentials:/app/credentials:ro \
  --env-file .env \
  --security-opt seccomp:unconfined \
  eladzazon/noga-whatsapp-assistant:latest
```

### 5. Run Locally (Development)

```bash
npm install
npm run dev
```

### 6. Connect WhatsApp

1. Open the dashboard at `http://localhost:3000`
2. Login with your dashboard credentials
3. Scan the QR code with WhatsApp (Linked Devices)

## 📱 Usage Examples

### Calendar
- "מה יש לי היום?" (What's on my calendar today?)
- "הוסיפי פגישה מחר ב-10 בוקר עם דני" (Add a meeting tomorrow at 10am with Dani)
- "מה יש בשבוע הקרוב?" (What's coming up this week?)

### Shopping List
- "תוסיפי חלב לרשימת הקניות" (Add milk to the shopping list)
- "מה ברשימה?" (What's on the list?)
- "קניתי לחם" (I bought bread - marks as complete)

### Smart Home
- "תדליקי אור בסלון" (Turn on the living room light)
- "כבי את כל האורות" (Turn off all lights)
- "מה הטמפרטורה בחדר?" (What's the room temperature?)

### Voice Messages
Send a voice note in Hebrew - Gemini will transcribe and process it!

## 🔧 Google API Setup

### Service Account (for Calendar)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the **Google Calendar API**
4. Go to **IAM & Admin** → **Service Accounts**
5. Create a service account
6. Download the JSON key file
7. Save it as `credentials/service-account.json`
8. **Share your calendar** with the service account email

### OAuth2 (for Tasks)

1. In Google Cloud Console, go to **APIs & Services** → **Credentials**
2. Create **OAuth 2.0 Client ID** (Desktop app)
3. Note the Client ID and Secret
4. Use the [OAuth Playground](https://developers.google.com/oauthplayground/) to get a refresh token:
   - Authorize `https://www.googleapis.com/auth/tasks`
   - Exchange for refresh token
5. Add credentials to `.env`

## 🏗️ Project Structure

```
src/
├── bot/
│   ├── WhatsAppManager.js    # WhatsApp client
│   ├── GeminiManager.js      # Gemini AI engine
│   └── MessageRouter.js      # Message routing
├── skills/
│   ├── CalendarManager.js    # Google Calendar
│   ├── TasksManager.js       # Google Tasks
│   ├── HomeAssistantManager.js
│   └── index.js              # Skill registry
├── dashboard/
│   ├── server.js             # Express + Socket.io
│   ├── views/                # EJS templates
│   └── public/               # Static files
├── database/
│   ├── DatabaseManager.js    # SQLite operations
│   └── schema.sql
├── utils/
│   ├── config.js             # Configuration
│   └── logger.js             # Logging
└── index.js                  # Entry point
```

## 🔌 Adding New Skills

1. Create a new manager in `src/skills/`:

```javascript
// src/skills/MyNewSkill.js
class MyNewSkill {
    async init() { /* ... */ }
    
    async myFunction(args) {
        // Your logic here
        return { success: true, data: /* ... */ };
    }
}

export default new MyNewSkill();
```

2. Add function declarations to `src/skills/index.js`:

```javascript
// Add to functionDeclarations array
{
    name: 'my_new_function',
    description: 'Description in Hebrew and English',
    parameters: {
        type: 'object',
        properties: { /* ... */ }
    }
}

// Add to functionHandlers object
my_new_function: async (args) => {
    return await myNewSkill.myFunction(args);
}
```

3. Initialize in `initializeSkills()` function.

## 🐳 Docker Configuration

The project automatically builds and pushes the image `eladzazon/noga-whatsapp-assistant:latest` to Docker Hub upon changes to the `main` branch via GitHub Actions.

The Docker setup includes:
- Alpine-based Node.js image with Chromium installed for WhatsApp Web execution
- Memory optimizations for tiny 1GB RAM instances
- Persistent volume for SQLite database
- Non-root user for security

```bash
# Pull the latest image
docker pull eladzazon/noga-whatsapp-assistant:latest

# Start using docker-compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop and remove containers
docker-compose down
```

## 🔒 Security Considerations

- **Whitelist**: Only specified phone numbers can interact with the bot
- **Session Security**: Change default passwords and session secrets
- **Service Account**: Has minimal calendar access only
- **Docker**: Runs as non-root user

## 📝 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DASHBOARD_PORT` | Dashboard port (default: 3000) | No |
| `DASHBOARD_USER` | Dashboard username | Yes |
| `DASHBOARD_PASSWORD` | Dashboard password | Yes |
| `SESSION_SECRET` | Express session secret | Yes |
| `WHATSAPP_WHITELIST` | Comma-separated phone numbers | Yes* |
| `WHATSAPP_GROUP_ID` | Specific group ID to respond in | Yes* |
| `GEMINI_API_KEY` | Google Gemini API key | Yes |
| `GOOGLE_SERVICE_ACCOUNT_PATH` | Path to service account JSON | No |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth2 client ID | No |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth2 client secret | No |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | OAuth2 refresh token | No |
| `CALENDAR_ID` | Google Calendar ID | No |
| `HOME_ASSISTANT_URL` | Home Assistant URL | No |
| `HOME_ASSISTANT_TOKEN` | Home Assistant token | No |
| `WEBHOOK_SECRET` | Secret for HA webhook | Yes (for webhook) |

*Either `WHATSAPP_WHITELIST` or `WHATSAPP_GROUP_ID` is required


## 🏠 Home Assistant Integration

You can trigger Noga from Home Assistant automations to send AI-composed announcements to your family group.

1. Add `WEBHOOK_SECRET` to your `.env` file (choose a strong password).
2. in `configuration.yaml` (Home Assistant), add a rest_command:

```yaml
rest_command:
  noga_notify:
    url: "http://YOUR_NOGA_IP:3000/api/notify"
    method: POST
    headers:
      x-webhook-secret: "YOUR_WEBHOOK_SECRET"
    content_type:  'application/json; charset=utf-8'
    payload: '{"event": "{{ event }}", "data": {{ data | to_json }} }'
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

Noga will receive this and say something like: "Attention everyone! The dryer just finished in the laundry room 🧺. Who wants to be a hero and take it out? 😎"

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT License - feel free to use and modify!

---

Made with ❤️ for Israeli smart homes 🇮🇱
