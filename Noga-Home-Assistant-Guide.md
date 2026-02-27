# 🏠 Noga Home Assistant Integration Guide

This guide explains how to connect your Home Assistant to Noga, so she can announce smart home events to your family WhatsApp group using AI.

## 1. Setup in Noga

First, ensure your `.env` file has a secure webhook secret:
```ini
WEBHOOK_SECRET=my_super_secret_webhook_key_123
```

## 2. Configure Home Assistant

Open your `configuration.yaml` in Home Assistant and add the following `rest_command`. 
Replace `YOUR_NOGA_IP` with the local IP address of the computer running Noga (e.g., `192.168.1.100`).

```yaml
rest_command:
  noga_notify:
    url: "http://YOUR_NOGA_IP:3000/api/notify"
    method: POST
    headers:
      x-webhook-secret: "my_super_secret_webhook_key_123"  # Must match your .env
    content_type:  'application/json; charset=utf-8'
    payload: '{"event": "{{ event }}", "data": {{ data | to_json }} }'
```

> **Note**: You must restart Home Assistant after editing `configuration.yaml`.

## 3. Monitor Noga Status (Optional)

You can monitor Noga's connection status (such as whether WhatsApp is ready or if you need to scan a new QR code) by adding a REST sensor to your Home Assistant `configuration.yaml`.

```yaml
sensor:
  - platform: rest
    name: "Noga WhatsApp Status"
    resource: "http://YOUR_NOGA_IP:3000/api/webhook/status"
    method: GET
    headers:
      x-webhook-secret: "my_super_secret_webhook_key_123"
    scan_interval: 60
    value_template: >
      {% if value_json.whatsapp.isReady == true %}
        Connected
      {% elif value_json.whatsapp.hasQrCode == true %}
        Needs QR Scan
      {% else %}
        Disconnected
      {% endif %}
    json_attributes:
      - whatsapp
      - gemini
```

## 4. Create Automations

Now you can use the `noga_notify` service in any automation!

### Example: Dryer Finished 🧺
When the dryer power drops below a certain level (meaning it's done):

```yaml
alias: "Announce Dryer Finished"
trigger:
  - platform: state
    entity_id: sensor.dryer_power
    to: "off"
    from: "on"
action:
  - service: rest_command.noga_notify
    data:
      event: "Dryer Machine Finished"
      data:
        location: "Laundry Room"
```
**Noga will say:** "Attention everyone! The dryer in the Laundry Room is done. Who wants to be awesome and empty it? 😉"

### Example: Door Left Open 🚪
When the front door is left open for more than 5 minutes:

```yaml
alias: "Alert: Front Door Open"
trigger:
  - platform: state
    entity_id: binary_sensor.front_door
    to: "on"
    for: "00:05:00"
action:
  - service: rest_command.noga_notify
    data:
      event: "Security Alert: Door Left Open"
      data:
        door: "Front Door"
        duration: "5 minutes"
```
**Noga will say:** "⚠️ Alert! The Front Door has been open for 5 minutes. Please check properly!"

### Example: Good Morning ☀️
Run this at 7:00 AM:

```yaml
alias: "Morning Announcement"
trigger:
  - platform: time
    at: "07:00:00"
action:
  - service: rest_command.noga_notify
    data:
      event: "Good Morning"
      data:
        temperature: "{{ states('sensor.outdoor_temperature') }}"
```
## 5. Control from WhatsApp (Entity Mapping)

You can now control your Home Assistant devices directly from WhatsApp using friendly Hebrew nicknames.

### Setup Mappings
1. Open the Noga Dashboard.
2. Go to the **Home Assistant** tab.
3. Use the **🔄 טען מכשירים מ-HA** button to see a list of your entities.
4. Click on an entity in the list to map it.
5. Provide a **Nickname** (Hebrew recommended) and a **Location**.
6. Save the mapping.

### Examples
Once mapped, you can send these commands to Noga:
- "תדליק את האור במטבח" (Turn on the kitchen light)
- "כבי את המזגן בסלון" (Turn off the living room AC)
- "מה המצב של התאורה בכניסה?" (What's the status of the entrance lighting?)

Noga uses your custom nicknames and locations to precisely identify which device you want to control.

## 6. AI Quota Handling

If you are using the Gemini Free Tier and reach your daily limit (429 error), Noga will:
1. Update the dashboard status for Gemini to **"מכסה נגמרה"** (Quota Exceeded) in red.
2. Respond to WhatsApp messages with: *"המכסה היומית של הבינה המלאכותית נגמרה 😅 אשתף פעולה שוב בקרוב!"*

The system will automatically recover as soon as your quota is reset.

## 7. Troubleshooting

- **Check Logs**: If it doesn't work, check the Noga logs (`npm run dev`).
- **"Unauthorized"**: Make sure the secret in `configuration.yaml` matches `.env`.
- **"WhatsApp client not ready"**: Scan the QR code in the dashboard one more time.
