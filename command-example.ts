/**
 * Command Control Example for Calliope Mini
 * Shows how to receive and react to commands from the web interface
 */

// ==================== Configuration ====================
const WIFI_SSID = "YourWiFiSSID"
const WIFI_PASSWORD = "YourWiFiPassword"
const SERVER_HOST = "192.168.1.100"
const SERVER_PORT = 5000
const DEVICE_ID = "Calliope001"

// Command polling interval (milliseconds)
const POLL_INTERVAL = 3000  // Check every 3 seconds

// LED state tracking
let ledState = false
let ledColor = "off"

// Command parsing variables
let lastCommand = ""
let lastValue = ""

// ==================== Initialize WiFi ====================
basic.showString("Init", 70)

// Enable WiFi debug to see data chunks
WiFi.setDebugMode(true)

WiFi.setupWifi(WIFI_SSID, WIFI_PASSWORD)
basic.pause(2000)

if (WiFi.checkWiFiConnection()) {
    basic.showIcon(IconNames.Yes)
    basic.pause(500)
} else {
    basic.showIcon(IconNames.No)
    basic.showString("No WiFi", 70)
    // Halt if no WiFi
    basic.forever(function() {
        basic.pause(1000)
    })
}

// ==================== Command Parser ====================
function parseCommand(body: string) {
    lastCommand = ""
    lastValue = ""
    
    // Simple JSON parsing for: {"command":"led_on","value":"red"}
    
    // Extract command
    let cmdStart = body.indexOf('"command":"')
    if (cmdStart >= 0) {
        cmdStart += 11  // Length of '"command":"'
        let cmdEnd = body.indexOf('"', cmdStart)
        if (cmdEnd > cmdStart) {
            lastCommand = body.substr(cmdStart, cmdEnd - cmdStart)
        }
    }
    
    // Extract value
    let valStart = body.indexOf('"value":"')
    if (valStart >= 0) {
        valStart += 9  // Length of '"value":"'
        let valEnd = body.indexOf('"', valStart)
        if (valEnd > valStart) {
            lastValue = body.substr(valStart, valEnd - valStart)
        }
    }
}

// ==================== Command Handlers ====================
function executeCommand(command: string, value: string) {
    // LED Control Commands
    if (command == "led_on") {
        ledState = true
        ledColor = value
        
        if (value == "red") {
            basic.showIcon(IconNames.Heart)
        } else if (value == "blue") {
            basic.showIcon(IconNames.Diamond)
        } else if (value == "green") {
            basic.showIcon(IconNames.Yes)
        } else if (value == "yellow") {
            basic.showIcon(IconNames.Happy)
        } else {
            basic.showLeds(`
                # # # # #
                # # # # #
                # # # # #
                # # # # #
                # # # # #
            `)
        }
        sendAck("led_on", value, "ok")
    }
    else if (command == "led_off") {
        ledState = false
        ledColor = "off"
        basic.clearScreen()
        sendAck("led_off", "", "ok")
    }
    
    // Display Commands
    else if (command == "show_icon") {
        if (value == "heart") {
            basic.showIcon(IconNames.Heart)
        } else if (value == "happy") {
            basic.showIcon(IconNames.Happy)
        } else if (value == "sad") {
            basic.showIcon(IconNames.Sad)
        } else if (value == "yes") {
            basic.showIcon(IconNames.Yes)
        } else if (value == "no") {
            basic.showIcon(IconNames.No)
        }
        sendAck("show_icon", value, "ok")
    }
    else if (command == "show_string") {
        basic.showString(value, 100)
        sendAck("show_string", value, "ok")
    }
    else if (command == "show_number") {
        let num = parseInt(value)
        basic.showNumber(num)
        sendAck("show_number", value, "ok")
    }
    
    // Sound Commands
    else if (command == "play_tone") {
        let frequency = parseInt(value)
        if (frequency > 0) {
            music.playTone(frequency, music.beat(BeatFraction.Whole))
        }
        sendAck("play_tone", value, "ok")
    }
    else if (command == "play_melody") {
        if (value == "happy") {
            music.playMelody("C D E F G A B C5 ", 120)
        } else if (value == "sad") {
            music.playMelody("C5 B A G F E D C ", 120)
        } else if (value == "beep") {
            music.playTone(880, music.beat(BeatFraction.Quarter))
        }
        sendAck("play_melody", value, "ok")
    }
    
    // Sensor Reading Commands
    else if (command == "read_sensors") {
        let temp = input.temperature()
        let light = input.lightLevel()
        let accelX = input.acceleration(Dimension.X)
        let accelY = input.acceleration(Dimension.Y)
        let accelZ = input.acceleration(Dimension.Z)
        
        let jsonData = `{"device_id":"${DEVICE_ID}","temperature":"${temp}","light":"${light}","accel_x":"${accelX}","accel_y":"${accelY}","accel_z":"${accelZ}"}`
        
        WiFi.httpPOST(SERVER_HOST, SERVER_PORT, "/api/sensor", jsonData)
        basic.pause(1000)
        
        sendAck("read_sensors", "sent", "ok")
    }
    
    // System Commands
    else if (command == "reset") {
        basic.showString("RST", 70)
        control.reset()
    }
    else if (command == "status") {
        let wifiOk = WiFi.checkWiFiConnection()
        let status = wifiOk ? "wifi_ok" : "wifi_fail"
        sendAck("status", status, "ok")
    }
    
    // Animation Commands
    else if (command == "animate") {
        if (value == "spin") {
            for (let i = 0; i < 8; i++) {
                basic.showLeds(`
                    . . # . .
                    . . . . .
                    . . . . .
                    . . . . .
                    . . . . .
                `)
                basic.pause(100)
                basic.showLeds(`
                    . . . . .
                    . . . # .
                    . . . . .
                    . . . . .
                    . . . . .
                `)
                basic.pause(100)
                basic.showLeds(`
                    . . . . .
                    . . . . .
                    . . . . #
                    . . . . .
                    . . . . .
                `)
                basic.pause(100)
                basic.showLeds(`
                    . . . . .
                    . . . . .
                    . . . . .
                    . . . # .
                    . . . . .
                `)
                basic.pause(100)
            }
        } else if (value == "flash") {
            for (let i = 0; i < 5; i++) {
                basic.showLeds(`
                    # # # # #
                    # # # # #
                    # # # # #
                    # # # # #
                    # # # # #
                `)
                basic.pause(200)
                basic.clearScreen()
                basic.pause(200)
            }
        }
        sendAck("animate", value, "ok")
    }
    
    // Unknown command
    else {
        basic.showString("?", 70)
        sendAck(command, value, "unknown")
    }
}

// ==================== Send Acknowledgment ====================
function sendAck(command: string, value: string, status: string) {
    // Send acknowledgment back to server
    let ackData = `{"device_id":"${DEVICE_ID}","ack":"${command}","value":"${value}","status":"${status}"}`
    WiFi.httpPOST(SERVER_HOST, SERVER_PORT, "/api/sensor", ackData)
    basic.pause(500)
}

// ==================== Command Polling Loop ====================
basic.forever(function () {
    // Poll for commands
    WiFi.httpGET(SERVER_HOST, SERVER_PORT, `/api/command/${DEVICE_ID}`)
    basic.pause(1000)
    
    if (WiFi.isHttpSuccess()) {
        let body = WiFi.getLastHttpBody()
        
        if (body.length > 0) {
            parseCommand(body)
            
            if (lastCommand.length > 0) {
                // Execute the command
                executeCommand(lastCommand, lastValue)
            }
        }
    }
    
    // Wait before next poll
    basic.pause(POLL_INTERVAL)
})

// ==================== Manual Controls ====================
// Button A: Report current status
input.onButtonPressed(Button.A, function () {
    let temp = input.temperature()
    let light = input.lightLevel()
    let jsonData = `{"device_id":"${DEVICE_ID}","temperature":"${temp}","light":"${light}","led_state":"${ledState}","led_color":"${ledColor}"}`
    
    WiFi.httpPOST(SERVER_HOST, SERVER_PORT, "/api/sensor", jsonData)
    basic.pause(1000)
    
    if (WiFi.isHttpSuccess()) {
        basic.showIcon(IconNames.Yes)
        basic.pause(500)
        basic.clearScreen()
    }
})

// ==================== Startup ====================
