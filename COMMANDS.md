# Command Control Examples

This file demonstrates comprehensive command handling from the web interface.

## 📋 Supported Commands

### LED Control
```bash
# Turn LED on with color
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"led_on","value":"red"}'

# Colors: red, blue, green, yellow, or empty for all LEDs

# Turn LED off
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"led_off"}'
```

### Display Commands
```bash
# Show icon
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"show_icon","value":"heart"}'
# Icons: heart, happy, sad, yes, no

# Show string
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"show_string","value":"Hello"}'

# Show number
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"show_number","value":"42"}'
```

### Sound Commands
```bash
# Play tone (frequency in Hz)
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"play_tone","value":"440"}'

# Play melody
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"play_melody","value":"happy"}'
# Melodies: happy, sad, beep
```

### Sensor Commands
```bash
# Request sensor reading
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"read_sensors"}'
# Device will read all sensors and send data back
```

### Animation Commands
```bash
# Spin animation
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"animate","value":"spin"}'

# Flash animation
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"animate","value":"flash"}'
```

### System Commands
```bash
# Get status
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"status"}'

# Reset device
curl -X POST http://localhost:5000/api/command \
  -H "Content-Type: application/json" \
  -d '{"device_id":"Calliope001","command":"reset"}'
```

## 🎮 Using the Web Dashboard

1. Open http://localhost:5000
2. Scroll to "Send Command to Device" section
3. Enter:
   - Device ID: `Calliope001`
   - Command: `led_on`
   - Value: `red`
4. Click "Send Command"
5. Watch the Calliope Mini react!

## 📊 How It Works

1. **Polling Loop** - Calliope polls `/api/command/:device_id` every 3 seconds
2. **Command Parsing** - Extracts command and value from JSON response
3. **Execution** - Calls appropriate handler based on command
4. **Acknowledgment** - Sends confirmation back to server with status

## 💡 Visual Indicators

- **LED (4,4)** - Flashes during polling
- **LED (0,4)** - Lights up when executing command
- **Button A** - Manually send status report
- **Button B** - Force immediate command check

## 🔧 Adding Custom Commands

To add your own command, edit `executeCommand()`:

```typescript
else if (command == "your_command") {
    // Your code here
    let param = parseInt(value)
    // Do something...
    
    sendAck("your_command", value, "ok")
}
```

## 📡 Command Flow

```
Web Interface → Server → Database
                  ↓
           Calliope polls
                  ↓
         Executes command
                  ↓
       Sends acknowledgment
                  ↓
         Server → Database
```

## ⚠️ Notes

- Commands are executed once and marked as completed
- If multiple commands are queued, they execute in order
- Commands return `404` when queue is empty (this is normal)
- Acknowledgments are stored as sensor data for tracking
