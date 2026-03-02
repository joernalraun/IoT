/**
 * Test code for Calliope Mini WiFi/HTTP functionality
 * Tests the improved TCP/IP and HTTP features with the Node.js server
 */

// ==================== Configuration ====================
const WIFI_SSID = "YourWiFiSSID"
const WIFI_PASSWORD = "YourWiFiPassword"
const SERVER_HOST = "192.168.1.100"  // Change to your server IP
const SERVER_PORT = 5000
const DEVICE_ID = "Calliope001"

// ==================== Test 1: Basic WiFi Connection ====================
input.onButtonPressed(Button.A, function () {
    basic.showString("WiFi", 70)
    
    // Connect to WiFi
    WiFi.setupWifi(WIFI_SSID, WIFI_PASSWORD)
    basic.pause(2000)
    
    // Verify connection
    if (WiFi.checkWiFiConnection()) {
        basic.showIcon(IconNames.Yes)
        basic.pause(1000)
        basic.showString("OK", 70)
    } else {
        basic.showIcon(IconNames.No)
        basic.showString("FAIL", 70)
    }
})

// ==================== Test 2: Send Sensor Data (HTTP POST) ====================
input.onButtonPressed(Button.B, function () {
    basic.showString("Send", 70)
    
    // Get temperature from Calliope
    let temperature = input.temperature().toString()
    
    // Send via HTTP POST with new improved function
    WiFi.sendSensorData(SERVER_HOST, SERVER_PORT, "/api/sensor", "temperature", temperature)
    basic.pause(2000)
    
    // Check HTTP response using new blocks
    if (WiFi.isHttpSuccess()) {
        basic.showIcon(IconNames.Yes)
        basic.pause(500)
        
        // Show HTTP status code
        basic.showNumber(WiFi.getLastHttpStatus())
    } else {
        basic.showIcon(IconNames.No)
        basic.pause(500)
        basic.showNumber(WiFi.getLastHttpStatus())
    }
})

// ==================== Test 3: Send Multiple Sensors ====================
input.onButtonPressed(Button.AB, function () {
    basic.showString("Multi", 70)
    
    // Build JSON with multiple sensor values
    let temp = input.temperature()
    let light = input.lightLevel()
    let accelX = input.acceleration(Dimension.X)
    
    let jsonData = `{"device_id":"${DEVICE_ID}","temperature":"${temp}","light":"${light}","accel_x":"${accelX}"}`
    
    // Send via HTTP POST
    WiFi.httpPOST(SERVER_HOST, SERVER_PORT, "/api/sensor", jsonData)
    basic.pause(2000)
    
    // Show response body
    if (WiFi.isHttpSuccess()) {
        basic.showIcon(IconNames.Yes)
        let body = WiFi.getLastHttpBody()
        serial.writeLine("Response: " + body)
    } else {
        basic.showIcon(IconNames.No)
    }
})

// ==================== Test 4: HTTP GET Request ====================
input.onGesture(Gesture.Shake, function () {
    basic.showString("GET", 70)
    
    // Request data from server
    WiFi.httpGET(SERVER_HOST, SERVER_PORT, `/api/sensor/${DEVICE_ID}`)
    basic.pause(2000)
    
    if (WiFi.isHttpSuccess()) {
        basic.showIcon(IconNames.Yes)
        
        // Parse and display response
        let body = WiFi.getLastHttpBody()
        serial.writeLine("Server says: " + body)
        
        // Try to extract temperature value (simple parsing)
        if (body.includes("temperature")) {
            basic.showString("Temp OK", 70)
        }
    } else {
        basic.showIcon(IconNames.No)
        basic.showNumber(WiFi.getLastHttpStatus())
    }
})

// ==================== Test 5: Check Server Status ====================
input.onGesture(Gesture.TiltLeft, function () {
    basic.showString("Status", 70)
    
    // Get server status
    WiFi.httpGET(SERVER_HOST, SERVER_PORT, "/api/status")
    basic.pause(2000)
    
    if (WiFi.isHttpSuccess()) {
        let status = WiFi.getLastHttpStatus()
        basic.showNumber(status)
        basic.pause(1000)
        
        // Show response body on serial
        serial.writeLine(WiFi.getLastHttpBody())
    } else {
        basic.showIcon(IconNames.No)
    }
})

// ==================== Test 6: Poll for Commands ====================
input.onGesture(Gesture.TiltRight, function () {
    basic.showString("Cmd", 70)
    
    // Check for pending commands from server
    WiFi.httpGET(SERVER_HOST, SERVER_PORT, `/api/command/${DEVICE_ID}`)
    basic.pause(2000)
    
    if (WiFi.isHttpSuccess()) {
        let body = WiFi.getLastHttpBody()
        serial.writeLine("Command: " + body)
        
        // Parse command (simple example)
        if (body.includes("led_on")) {
            basic.showIcon(IconNames.Heart)
        } else if (body.includes("led_off")) {
            basic.clearScreen()
        } else {
            basic.showString("?", 70)
        }
    } else if (WiFi.getLastHttpStatus() == 404) {
        // No commands available
        basic.showString("Empty", 70)
    } else {
        basic.showIcon(IconNames.No)
    }
})

// ==================== Test 7: Continuous Monitoring Loop ====================
let monitoringActive = false

input.onLogoEvent(TouchButtonEvent.Pressed, function () {
    monitoringActive = !monitoringActive
    
    if (monitoringActive) {
        basic.showString("Start", 70)
    } else {
        basic.showString("Stop", 70)
    }
})

// Background monitoring loop
basic.forever(function () {
    if (monitoringActive) {
        // Show activity indicator
        led.plot(0, 0)
        
        // Send sensor data every cycle
        let temp = input.temperature()
        let light = input.lightLevel()
        
        let jsonData = `{"device_id":"${DEVICE_ID}","temperature":"${temp}","light":"${light}"}`
        
        WiFi.httpPOST(SERVER_HOST, SERVER_PORT, "/api/sensor", jsonData)
        basic.pause(1000)
        
        // Check if successful
        if (WiFi.isHttpSuccess()) {
            led.plot(4, 0)  // Success indicator
        } else {
            led.unplot(4, 0)
        }
        
        basic.pause(4000)  // Wait 5 seconds total between sends
        led.unplot(0, 0)
    }
})

// ==================== Test 8: Connection Status Check ====================
// Run every 30 seconds to verify connections
basic.forever(function () {
    if (!monitoringActive) {
        basic.pause(30000)
        
        // Quick status check
        let wifiOk = WiFi.checkWiFiConnection()
        
        if (wifiOk) {
            led.plot(2, 4)  // Bottom center LED = WiFi OK
        } else {
            led.unplot(2, 4)
        }
    }
})

// ==================== Startup Message ====================
basic.showString("Ready", 70)
basic.showIcon(IconNames.Happy)
basic.pause(1000)
basic.clearScreen()

// Show instructions on serial
serial.writeLine("=== Calliope Mini WiFi Test ===")
serial.writeLine("A: Connect WiFi")
serial.writeLine("B: Send Temperature")
serial.writeLine("A+B: Send Multiple Sensors")
serial.writeLine("Shake: HTTP GET data")
serial.writeLine("Tilt Left: Server Status")
serial.writeLine("Tilt Right: Get Commands")
serial.writeLine("Logo Touch: Toggle Monitoring")
serial.writeLine("===============================")
