# Calliope Mini WiFi Examples

Complete examples for using TCP/IP communication with your IoT platform.

## Setup

### 1. WiFi Connection

```typescript
// On start
WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")

// Wait for connection
while (!WiFi.checkWiFiConnection()) {
    basic.pause(1000)
}

basic.showIcon(IconNames.Yes)
```

## Example 1: Simple Temperature Monitor

Send temperature data every 10 seconds.

```typescript
WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")

basic.forever(function () {
    if (WiFi.checkWiFiConnection()) {
        let temp = input.temperature()
        
        WiFi.sendSensorData(
            "192.168.1.100",  // Your server IP
            5000,
            "/api/sensor",
            "temperature",
            "" + temp
        )
        
        basic.showNumber(temp)
    }
    
    basic.pause(10000)
})
```

## Example 2: Multi-Sensor Data Logger

Send multiple sensor readings in one request.

```typescript
WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")

input.onButtonPressed(Button.A, function () {
    let temp = input.temperature()
    let light = input.lightLevel()
    let compass = input.compassHeading()
    
    // Build JSON manually
    let json = "{\"device_id\":\"Calliope001\","
    json += "\"temperature\":\"" + temp + "\","
    json += "\"light\":\"" + light + "\","
    json += "\"compass\":\"" + compass + "\"}"
    
    WiFi.httpPOST(
        "192.168.1.100",
        5000,
        "/api/sensor",
        json
    )
    
    basic.showIcon(IconNames.Yes)
    basic.pause(500)
    basic.clearScreen()
})
```

## Example 3: Remote LED Control

Receive commands from server to control the LED display.

```typescript
WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")

basic.forever(function () {
    // Check for commands
    WiFi.httpGET(
        "192.168.1.100",
        5000,
        "/api/command/Calliope001"
    )
    
    let response = WiFi.getLastTCPData()
    
    // Parse response
    if (response.includes("\"command\":\"heart\"")) {
        basic.showIcon(IconNames.Heart)
    } else if (response.includes("\"command\":\"happy\"")) {
        basic.showIcon(IconNames.Happy)
    } else if (response.includes("\"command\":\"clear\"")) {
        basic.clearScreen()
    } else if (response.includes("\"command\":\"text\"")) {
        // Extract text value from JSON
        // Simple parsing for: {"command":"text","value":"Hello"}
        let valueStart = response.indexOf("\"value\":\"") + 9
        let valueEnd = response.indexOf("\"", valueStart)
        if (valueStart > 8 && valueEnd > valueStart) {
            let text = response.substr(valueStart, valueEnd - valueStart)
            basic.showString(text)
        }
    }
    
    basic.pause(3000)  // Check every 3 seconds
})
```

## Example 4: Button-Triggered Events

Send events when buttons are pressed.

```typescript
WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")

input.onButtonPressed(Button.A, function () {
    WiFi.sendSensorData(
        "192.168.1.100",
        5000,
        "/api/sensor",
        "button",
        "A"
    )
    basic.showString("A")
})

input.onButtonPressed(Button.B, function () {
    WiFi.sendSensorData(
        "192.168.1.100",
        5000,
        "/api/sensor",
        "button",
        "B"
    )
    basic.showString("B")
})

input.onButtonPressed(Button.AB, function () {
    WiFi.sendSensorData(
        "192.168.1.100",
        5000,
        "/api/sensor",
        "button",
        "AB"
    )
    basic.showString("AB")
})
```

## Example 5: Gesture Recognition

Send gesture data to the platform.

```typescript
WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")

input.onGesture(Gesture.Shake, function () {
    WiFi.sendSensorData(
        "192.168.1.100",
        5000,
        "/api/sensor",
        "gesture",
        "shake"
    )
    basic.showIcon(IconNames.Surprised)
    basic.pause(500)
    basic.clearScreen()
})

input.onGesture(Gesture.TiltLeft, function () {
    WiFi.sendSensorData(
        "192.168.1.100",
        5000,
        "/api/sensor",
        "gesture",
        "tilt_left"
    )
})

input.onGesture(Gesture.TiltRight, function () {
    WiFi.sendSensorData(
        "192.168.1.100",
        5000,
        "/api/sensor",
        "gesture",
        "tilt_right"
    )
})
```

## Example 6: Accelerometer Data Stream

Send acceleration data for motion detection.

```typescript
WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")

basic.forever(function () {
    let x = input.acceleration(Dimension.X)
    let y = input.acceleration(Dimension.Y)
    let z = input.acceleration(Dimension.Z)
    
    let json = "{\"device_id\":\"Calliope001\","
    json += "\"accel_x\":\"" + x + "\","
    json += "\"accel_y\":\"" + y + "\","
    json += "\"accel_z\":\"" + z + "\"}"
    
    WiFi.httpPOST(
        "192.168.1.100",
        5000,
        "/api/sensor",
        json
    )
    
    basic.pause(1000)  // 1 Hz sampling
})
```

## Example 7: Two-Way Communication

Send data and receive commands in one cycle.

```typescript
WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")

let deviceId = "Calliope001"
let serverIp = "192.168.1.100"
let serverPort = 5000

basic.forever(function () {
    // 1. Send sensor data
    let temp = input.temperature()
    WiFi.sendSensorData(
        serverIp,
        serverPort,
        "/api/sensor",
        "temperature",
        "" + temp
    )
    
    basic.pause(500)
    
    // 2. Check for commands
    WiFi.httpGET(
        serverIp,
        serverPort,
        "/api/command/" + deviceId
    )
    
    let response = WiFi.getLastTCPData()
    
    // 3. Execute commands
    if (response.includes("led_on")) {
        basic.showIcon(IconNames.Heart)
    } else if (response.includes("led_off")) {
        basic.clearScreen()
    }
    
    basic.pause(5000)
})
```

## Example 8: Connection Status Monitor

Visual feedback for connection status.

```typescript
WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")

basic.forever(function () {
    if (WiFi.checkWiFiConnection()) {
        // WiFi connected - show green dot
        led.plot(0, 0)
        
        // Try to send data
        let temp = input.temperature()
        WiFi.sendSensorData(
            "192.168.1.100",
            5000,
            "/api/sensor",
            "temperature",
            "" + temp
        )
    } else {
        // WiFi disconnected - show red pattern
        led.unplot(0, 0)
        basic.showIcon(IconNames.No)
        basic.pause(500)
        basic.clearScreen()
    }
    
    basic.pause(10000)
})
```

## Example 9: Raw TCP Custom Protocol

Use raw TCP for custom protocols.

```typescript
WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")

input.onButtonPressed(Button.A, function () {
    // Connect to TCP server
    WiFi.connectTCP("192.168.1.100", 8080)
    basic.pause(1000)
    
    if (WiFi.isTCPConnected()) {
        // Send custom protocol data
        let message = "TEMP:" + input.temperature() + "\n"
        WiFi.sendTCP(message)
        
        basic.pause(500)
        
        // Read response
        let response = WiFi.getLastTCPData()
        basic.showString(response)
        
        // Close connection
        WiFi.closeTCP()
    }
})
```

## Example 10: Error Handling

Robust error handling for unreliable networks.

```typescript
WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")

function sendDataWithRetry() {
    let retries = 3
    let success = false
    
    while (retries > 0 && !success) {
        if (WiFi.checkWiFiConnection()) {
            let temp = input.temperature()
            WiFi.sendSensorData(
                "192.168.1.100",
                5000,
                "/api/sensor",
                "temperature",
                "" + temp
            )
            
            // Check if data was sent (simplified)
            basic.pause(500)
            success = true
            basic.showIcon(IconNames.Yes)
        } else {
            // Reconnect WiFi
            basic.showIcon(IconNames.No)
            WiFi.setupWifi("YOUR_SSID", "YOUR_PASSWORD")
            retries -= 1
            basic.pause(2000)
        }
    }
    
    if (!success) {
        basic.showString("ERR")
    }
    
    basic.pause(500)
    basic.clearScreen()
}

basic.forever(function () {
    sendDataWithRetry()
    basic.pause(10000)
})
```

## Testing with Dashboard

1. **Start the server**: `python server/server.py`
2. **Open dashboard**: http://localhost:5000
3. **Flash your Calliope** with one of the examples above
4. **Watch data appear** in real-time on the dashboard
5. **Send commands** from the dashboard control panel

## Network Configuration

Replace these values in all examples:
- `"192.168.1.100"` → Your computer's local IP address
- `5000` → Server port (default is 5000)
- `"YOUR_SSID"` → Your WiFi network name
- `"YOUR_PASSWORD"` → Your WiFi password
- `"Calliope001"` → Unique device ID for each Calliope

## Debugging Tips

1. **Use Debug Mode** (optional - add if needed in wifi.ts):
   ```typescript
   WiFi.setDebugMode(true)  // If this function exists
   ```

2. **Check LED indicators**:
   - LED at (4,0) blinks during AT commands
   - Visual feedback for connection status

3. **Monitor server logs**: Watch the terminal running `server.py`

4. **Test with Python client**: Run `python server/example_client.py`

5. **Use serial debugging**: Connect USB and check serial output

## Next Steps

- Customize the server dashboard
- Add more sensor types
- Implement two-way control
- Create automation rules
- Store data in cloud database
- Build mobile app interface
