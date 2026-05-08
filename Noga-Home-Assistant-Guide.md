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
    payload: '{"event": "{{ event }}", "data": {{ data | default({}) | to_json }} }'
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
alias: "Announce Good Morning"
trigger:
  - platform: time
    at: "07:00:00"
action:
  - service: rest_command.noga_notify
    data:
      event: "Morning Routine"
      data:
        weather: "Sunny, 25°C"
        calendar_events: "Doctor appointment at 10:00 AM"
```
**Noga will say:** "Good morning everyone! ☀️ It's a beautiful sunny day (25°C). Just a quick reminder about the doctor appointment at 10:00 AM. Have a great day!"

### Example: Camera Snapshot with Image 📷
Noga supports receiving images via `multipart/form-data`. Since Home Assistant's `rest_command` doesn't support file uploads easily, you can use a `shell_command` with `curl` to send a camera snapshot along with an event.

First, add a `shell_command` to your `configuration.yaml`:

```yaml
shell_command:
  noga_notify_image: >
    curl -X POST "http://YOUR_NOGA_IP:3000/api/notify"
    -H "x-webhook-secret: my_super_secret_webhook_key_123"
    -F "event={{ event }}"
    -F "image=@{{ image_path }}"
```

Then, you can use it in an automation. For example, when motion is detected at the front door:

```yaml
alias: "Camera Snapshot on Motion"
trigger:
  - platform: state
    entity_id: binary_sensor.front_door_motion
    to: "on"
action:
  # 1. Take the snapshot and save it to a temporary location
  - service: camera.snapshot
    target:
      entity_id: camera.front_door
    data:
      filename: "/config/www/tmp/front_door_snapshot.jpg"
  
  # 2. Give Home Assistant a second to save the file
  - delay: "00:00:01"
  
  # 3. Send it to Noga
  - service: shell_command.noga_notify_image
    data:
      event: "Motion detected at the front door"
      image_path: "/config/www/tmp/front_door_snapshot.jpg"
```
**Noga will send:** The image of the front door with the exact text provided in the `event` field as the caption: "Motion detected at the front door". 
*(Note: To ensure fast delivery, Noga bypasses AI text generation when an image is attached and simply uses your exact event text).*

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
