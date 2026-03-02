/**
 * Functions to operate Grove module.
 */
let WiFiDebugMode = false
//% weight=10 color=#9F79EE icon="\uf1b3" block="WiFi"
namespace WiFi {
    let isWifiConnected = false
    let isMqttConnected = false

    // Global serial pin configuration
    let txPin = SerialPin.C17
    let rxPin = SerialPin.C16
    let baudRate = BaudRate.BaudRate115200

    // MQTT listener variables
    let isListening = false
    let lastReceivedMessage = ""
    let topicValues: { [topic: string]: string } = {}

    // TCP/IP connection variables
    let isTcpConnected = false
    let tcpLinkId = 1  // Use link ID 1 for TCP (0 reserved for MQTT)
    let tcpServerRunning = false
    let lastTcpData = ""
    let tcpDataReceived = false
    let lastHttpStatus = 0
    let lastHttpBody = ""

    serial.setRxBufferSize(192)
    serial.setTxBufferSize(64)
    serial.redirect(txPin, rxPin, baudRate);
    /**
     * Enable or disable debug output on USB serial
     */
    //% block="WiFi debug mode %on" advanced=true
    //% weight=105
    //% group="Connection"
    export function setDebugMode(on: boolean) {
        WiFiDebugMode = on
    }


    /**
     * Configure serial pins for ESP32 communication
     */
    //% block="Configure Serial Pins|TX %tx|RX %rx|Baud Rate %baud"
    //% weight=110
    //% group="Connection"
    //% tx.defl=SerialPin.C17
    //% rx.defl=SerialPin.C16
    //% baud.defl=BaudRate.BaudRate115200
    export function configureSerialPins(tx: SerialPin, rx: SerialPin, baud: BaudRate) {
        txPin = tx
        rxPin = rx
        baudRate = baud
        serial.redirect(txPin, rxPin, baudRate)
    }

    /**
     * Clear serial buffer to prevent data contamination
     */
    function clearSerialBuffer() {
        // Read and discard any pending data
        let attempts = 0
        while (attempts < 10) {
            let data = serial.readString()
            if (data.length == 0) break
            attempts++
            basic.pause(10)
        }
    }

    /**
     * Read data with chunking support for large responses
     */
    function readChunkedData(timeout: number): string {
        let fullData = ""
        let start = input.runningTime()
        let noDataCount = 0
        
        while (input.runningTime() - start < timeout) {
            let chunk = serial.readString()
            if (chunk.length > 0) {
                fullData += chunk
                noDataCount = 0
            } else {
                noDataCount++
                if (noDataCount > 20) break  // No data for 1 second
            }
            basic.pause(50)
        }
        
        return fullData
    }



    /**
     * Extract HTTP status code from response
     */
    function parseHttpStatus(response: string): number {
        // Look for "HTTP/1.1 200 OK" or similar
        let lines = response.split("\n")
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i]
            if (line.includes("HTTP/1.1") || line.includes("HTTP/1.0")) {
                // Extract status code (e.g., "HTTP/1.1 200 OK")
                let parts = line.split(" ")
                if (parts.length >= 2) {
                    let status = parseInt(parts[1])
                    if (status > 0) return status
                }
            }
        }
        return 0
    }

    /**
     * Extract HTTP body from response (content after headers)
     */
    function parseHttpBody(response: string): string {
        // Find JSON body directly
        let jsonStart = response.indexOf("{")
        if (jsonStart >= 0) {
            // Find last closing brace by searching backwards
            let jsonEnd = -1
            for (let i = response.length - 1; i > jsonStart; i--) {
                if (response.charAt(i) == "}") {
                    jsonEnd = i
                    break
                }
            }
            if (jsonEnd > jsonStart) {
                return response.substr(jsonStart, jsonEnd - jsonStart + 1)
            }
        }
        return ""
    }

    export function sendATCmd(cmd: string) {
        led.plot(4, 0)  // Turn on LED to indicate command start
        
        // Clear any pending data before sending command
        clearSerialBuffer()
        
        if (WiFiDebugMode) {
            serial.redirectToUSB()
            basic.pause(50)
            serial.writeString("CMD:" + cmd + "\r\n")
            basic.pause(50)
            serial.redirect(txPin, rxPin, baudRate);
        }
        serial.writeString(cmd + "\r\n")
        basic.pause(100)
        led.unplot(4, 0)  // Turn off LED when command is sent
    }
    export function waitAtResponse(target1: string, target2: string, target3: string, timeout: number) {
        let start = input.runningTime()
        let result = 0
        let received = ""

        while (input.runningTime() - start < timeout && result == 0) {
            let line = serial.readString()
            if (line.length > 0) {
                received += line + "\n"

                if (line.includes(target1)) {
                    result = 1
                    break
                }
                if (line.includes(target2)) {
                    result = 2
                    break
                }
                if (line.includes(target3)) {
                    result = 3
                    break
                }
            }
            basic.pause(100)
        }

        // Update lastReceivedMessage with the full response
        lastReceivedMessage = received

        if (WiFiDebugMode) {
            serial.redirectToUSB()
            basic.pause(50)
            serial.writeString("RCV:" + received + " (result:" + result + ")\r\n")
            basic.pause(50)
            serial.redirect(txPin, rxPin, baudRate);
        }

        return result
    }
    /**
     * Setup Uart WiFi to connect to  Wi-Fi
     */
    //% block="Connect to WiFi|SSID %ssid|Password %passwd"
    //% weight=100
    //% group="Connection"
    export function setupWifi(ssid: string, passwd: string) {
        isWifiConnected = false
        let result = 0
        serial.redirect(txPin, rxPin, baudRate)
        basic.pause(100)
        sendATCmd('AT')
        result = waitAtResponse("OK", "ERROR", "FAIL", 500)
        sendATCmd('AT+CWMODE=1')
        result = waitAtResponse("OK", "ERROR", "FAIL", 500)
        sendATCmd(`AT+CWJAP="${ssid}","${passwd}"`)
        result = waitAtResponse("WIFI GOT IP", "ERROR", "FAIL", 5000)
        if (result == 1) {
            isWifiConnected = true
            basic.showString("WIFI OK", 70)
        } else {
            basic.showString("WIFI Failed", 70)
        }
    }


    /**
     * Check actual WiFi connection status using AT command
     */
    //% block="WiFi Connected"
    //% weight=95
    //% group="Monitoring"
    //% blockSetVariable="wifiStatus"
    export function checkWiFiConnection(): boolean {
        sendATCmd('AT+CWJAP?')
        let result = waitAtResponse("+CWJAP:", "No AP", "ERROR", 2000)

        if (result == 1) {
            // Response contains +CWJAP: with connection info = connected
            isWifiConnected = true  // Update local status
            return true
        } else if (result == 2) {
            // Response contains "No AP" = not connected
            isWifiConnected = false  // Update local status
            return false
        }

        // ERROR or timeout - assume not connected
        isWifiConnected = false
        return false
    }
    /**
     * Get current WiFi SSID and signal strength
     */
    //% block="Get WiFi Info" advanced=true
    //% weight=30
    //% group="Monitoring"
    export function getWiFiInfo(): string {
        sendATCmd('AT+CWJAP?')
        let result = waitAtResponse("+CWJAP:", "No AP", "ERROR", 2000)

        if (result == 1) {
            // Parse response to extract SSID and RSSI
            // Format: +CWJAP:"SSID","MAC",channel,rssi
            return lastReceivedMessage  // Return full info for now
        } else if (result == 2) {
            return "No WiFi Connection"
        }

        return "WiFi Check Failed"
    }
    /**
     * Reset ESP32 module to factory defaults
     */
    //% block="Reset Module to Factory Defaults" advanced=true
    //% weight=15
    //% group="Advanced"
    export function resetModule() {

        sendATCmd('AT+RESTORE')
        let result = waitAtResponse("ready", "ERROR", "FAIL", 3000)

        if (result == 1) {
            // Reset global connection status
            isWifiConnected = false
            isMqttConnected = false

            basic.showString("Reset OK", 70)
        } else {
            basic.showString("Reset Failed", 70)
        }
    }
    /**
     * Setup MQTT connection with broker
     */
    //% block="Connect to MQTT Broker|Broker %broker|Port %port|Client ID %clientId|Username %username|Password %password"
    //% weight=90
    //% group="Connection"
    //% port.defl=1883
    //% clientId.defl="Device001"
    export function setupMQTT(broker: string, port: number, clientId: string, username: string, password: string) {
        let result = 0
        let mqttstate = checkMQTTConnection()
        basic.pause(100)
        if (!isMqttConnected) {
            if (mqttstate) {
                sendATCmd(`AT+MQTTCLEAN=0`)
                result = waitAtResponse("OK", "ERROR", "FAIL", 2000)
                basic.pause(500)
            }

            // Configure MQTT user settings
            sendATCmd(`AT+MQTTUSERCFG=0,1,"${clientId}","${username}","${password}",0,0,""`)
            result = waitAtResponse("OK", "ERROR", "FAIL", 2000)
            if (result != 1) {
                basic.showString("User CFG Failed", 70)
                return
            }

            // Set MQTT broker connection
            sendATCmd(`AT+MQTTCONN=0,"${broker}",${port},1`)
            result = waitAtResponse("OK", "ERROR", "FAIL", 5000)
            if (result == 1) {
                isMqttConnected = true
                basic.showString("MQTT OK", 70)
            }
            else {
                basic.showString("MQTT Failed", 70)
                return
            }
        }
        else {
            basic.showString("MQTT already setup", 70)
        }
    }

    /**
     * Publish message to MQTT topic
     */
    //% block="Publish to MQTT|Topic %topic|Message %message"
    //% weight=80
    //% group="MQTT Operations"
    export function publishMQTT(topic: string, message: string) {
        if (!isMqttConnected) {
            basic.showString("Not Connected", 70)
            return
        }
        
        // Clear buffer before publishing to avoid contamination
        clearSerialBuffer()
        basic.pause(100)  // Extra pause before publish
        
        sendATCmd(`AT+MQTTPUB=0,"${topic}","${message}",1,0`)
        let result = waitAtResponse("OK", "ERROR", "FAIL", 3000)  // Longer timeout
        
        basic.pause(200)  // Extra pause after publish
    }

    /**
     * Disconnect from MQTT broker
     */
    //% block="Disconnect from MQTT" advanced=true
    //% weight=20
    //% group="Advanced"
    export function disconnectMQTT() {
        sendATCmd('AT+MQTTCLEAN=0')
        waitAtResponse("OK", "ERROR", "FAIL", 2000)
        isMqttConnected = false
        basic.showString("Disconnected", 70)
    }

    /**
     * Subscribe to MQTT topic/feed
     */
    //% block="Subscribe to MQTT|Topic %topic|QoS %qos"
    //% weight=75
    //% group="MQTT Operations"
    //% qos.defl=0
    export function subscribeMQTT(topic: string, qos: number) {
        if (!isMqttConnected) {
            basic.showString("Not Connected", 70)
            return
        }

        sendATCmd(`AT+MQTTSUB=0,"${topic}",${qos}`)
        let result = waitAtResponse("OK", "ALREADY SUBSCRIBE", "ERROR", 3000)
        if (result == 2) {
            basic.showString("Already Sub", 70)
        }
        if (result == 3) {
            basic.showString("Sub Failed", 70)
        }
    }

    /**
     * Start MQTT message listener using serial events
     */
    //% block="Start MQTT Listener"
    //% weight=70
    //% group="MQTT Operations"
    export function startMQTTListener() {
        if (!isMqttConnected) {
            basic.showString("Not Connected", 70)
            return
        }

        isListening = true
        //basic.showString("...", 70)

        // Set up serial event listener for incoming data
        serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
            if (isListening && isMqttConnected) {
                let line = serial.readUntil(serial.delimiters(Delimiters.NewLine))

                if (line.length > 0) {
                    if (WiFiDebugMode) {
                        serial.redirectToUSB()
                        basic.pause(10)
                        serial.writeString("EVENT:" + line + "\r\n")
                        basic.pause(10)
                        serial.redirect(txPin, rxPin, baudRate);
                    }

                    if (line.includes("+MQTTSUBRECV:")) {
                        // Parse the MQTT message: +MQTTSUBRECV:<LinkID>,"<topic>",<data_length>,<data>
                        lastReceivedMessage = line

                        // Parse topic and message content
                        let parts = line.split(",")
                        if (parts.length >= 4) {
                            // Extract topic (remove quotes) - MakeCode compatible way
                            let topic = parts[1]
                            if (topic.charAt(0) == "\"") {
                                topic = topic.substr(1)  // Remove first quote
                            }
                            if (topic.charAt(topic.length - 1) == "\"") {
                                topic = topic.substr(0, topic.length - 1)  // Remove last quote
                            }

                            // Extract message data (everything after the third comma) - MakeCode compatible
                            let dataIndex = line.indexOf(",", line.indexOf(",", line.indexOf(",") + 1) + 1) + 1
                            if (dataIndex > 0 && dataIndex < line.length) {
                                let messageData = line.substr(dataIndex)  // Use substr instead of substring

                                // Trim whitespace manually since trim() might not be available
                                while (messageData.length > 0 && (messageData.charAt(0) == " " || messageData.charAt(0) == "\r" || messageData.charAt(0) == "\n")) {
                                    messageData = messageData.substr(1)
                                }
                                while (messageData.length > 0 && (messageData.charAt(messageData.length - 1) == " " || messageData.charAt(messageData.length - 1) == "\r" || messageData.charAt(messageData.length - 1) == "\n")) {
                                    messageData = messageData.substr(0, messageData.length - 1)
                                }

                                // Store the value for this topic
                                topicValues[topic] = messageData

                                if (WiFiDebugMode) {
                                    serial.redirectToUSB()
                                    basic.pause(10)
                                    serial.writeString("TOPIC:" + topic + " VALUE:" + messageData + "\r\n")
                                    basic.pause(10)
                                    serial.redirect(txPin, rxPin, baudRate);
                                }
                            }
                        }
                    }
                }
            }
        })
    }

    /**
     * Stop MQTT message listener
     */
    //% block="Stop MQTT Listener" advanced=true
    //% weight=25
    //% group="Advanced"
    export function stopMQTTListener() {
        isListening = false
        // Note: We can't easily remove the serial event handler in MakeCode
        // but we use isListening flag to ignore events when stopped
        basic.showString("Stopped", 70)
    }

    /**
     * Get the last received MQTT message
     */
    //% block="Last MQTT Message" advanced=true
    //% weight=35
    //% group="Advanced"
    //% blockSetVariable="message"
    export function getLastMQTTMessage(): string {
        return lastReceivedMessage
    }

    /**
     * Get the value for a specific MQTT topic
     */
    //% block="Get MQTT Value|Topic %topic"
    //% weight=65
    //% group="MQTT Operations"
    //% blockSetVariable="value"
    export function getMQTTTopicValue(topic: string): string {
        if (topicValues[topic]) {
            return topicValues[topic]
        }
        return ""
    }

    /**
     * Check if a topic has received a value
     */
    //% block="Topic %topic Has Value" advanced=true
    //% weight=40
    //% group="Monitoring"
    export function topicHasValue(topic: string): boolean {
        return topicValues[topic] != undefined && topicValues[topic].length > 0
    }


    /**
     * Clear all topic values
     */
    //% block="Clear All Topic Values" advanced=true
    //% weight=10
    //% group="Advanced"
    export function clearAllTopicValues() {
        topicValues = {}
    }

    /**
     * Clear serial communication buffer
     */
    //% block="Clear Serial Buffer" advanced=true
    //% weight=8
    //% group="Advanced"
    export function clearBuffer() {
        clearSerialBuffer()
        if (WiFiDebugMode) {
            serial.redirectToUSB()
            basic.pause(50)
            serial.writeString("Serial buffer cleared\r\n")
            basic.pause(50)
            serial.redirect(txPin, rxPin, baudRate);
        }
    }

    /**
     * Check if listener is running
     */
    //% block="MQTT Listener Running" advanced=true
    //% weight=50
    //% group="Monitoring"
    //% blockSetVariable="listenerStatus"
    export function isMQTTListenerRunning(): boolean {
        return isListening
    }


    /**
     * Check if MQTT is connected by querying connection status
     */
    //% block="MQTT Connected" 
    //% weight=85
    //% group="Monitoring"
    //% blockSetVariable="mqttStatus"
    export function checkMQTTConnection(): boolean {
        sendATCmd('AT+MQTTCONN?')
        let result = waitAtResponse("+MQTTCONN:", "ERROR", "FAIL", 2000)

        if (result == 1) {
            // Look for the +MQTTCONN line in the response
            let lines = lastReceivedMessage.split("\n")
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i]
                if (line.includes("+MQTTCONN:")) {
                    // Check if response matches factory default pattern: +MQTTCONN:0,0,0,"","","",0
                    if (line.includes('+MQTTCONN:0,0,0,"","","",0')) {
                        isMqttConnected = false
                        return false  // Factory default = not connected
                    }

                    // Parse the response to check the state value (second parameter)
                    // Format: +MQTTCONN:linkID,state,scheme,host,port,path,reconnect
                    let parts = line.split(",")
                    if (parts.length >= 2) {
                        let state = parseInt(parts[1])
                        if (state >= 4) {
                            isMqttConnected = true  // Update global status if fully connected
                            return true
                        }
                    }
                    break
                }
            }
        }

        isMqttConnected = false
        return false // Query failed or no response
    }
    /**
     * Quick status check - returns true if WiFi connected and MQTT is connected
     */
    //% block="WiFi & MQTT Ready"
    //% weight=90
    //% group="Monitoring"
    //% blockSetVariable="isReady"
    export function isWiFiAndMQTTReady(): boolean {
        let wifiStatus = checkWiFiConnection()
        let mqttStatus = checkMQTTConnection()
        basic.pause(50)

        if (WiFiDebugMode) {
            serial.redirectToUSB()
            basic.pause(50)
            serial.writeString("Ready Check - WiFi:" + (wifiStatus ? "OK" : "FAIL") + " MQTT:" + (mqttStatus ? "OK" : "FAIL") + "\r\n")
            basic.pause(50)
            serial.redirect(txPin, rxPin, baudRate);
        }

        return isWifiConnected && isMqttConnected
    }

    // ==================== TCP/IP Functions ====================

    /**
     * Enable multiple TCP connections (required for TCP operations)
     */
    //% block="Enable Multiple Connections" advanced=true
    //% weight=95
    //% group="TCP/IP"
    export function enableMultipleConnections() {
        sendATCmd('AT+CIPMUX=1')
        let result = waitAtResponse("OK", "ERROR", "FAIL", 1000)
    }

    /**
     * Connect to TCP server
     */
    //% block="Connect TCP|Host %host|Port %port"
    //% weight=90
    //% group="TCP/IP"
    //% port.defl=80
    export function connectTCP(host: string, port: number) {
        // Validate WiFi is connected first
        if (!isWifiConnected) {
            return
        }
        
        isTcpConnected = false
        clearSerialBuffer()
        
        // Enable multiple connections first
        sendATCmd('AT+CIPMUX=1')
        waitAtResponse("OK", "ERROR", "FAIL", 1000)
        
        // Start TCP connection
        sendATCmd(`AT+CIPSTART=${tcpLinkId},"TCP","${host}",${port}`)
        let result = waitAtResponse("CONNECT", "ERROR", "ALREADY CONNECTED", 5000)
        
        if (result == 1 || result == 3) {
            isTcpConnected = true
        }
    }

    /**
     * Send data over TCP connection
     */
    //% block="Send TCP Data|Data %data"
    //% weight=85
    //% group="TCP/IP"
    export function sendTCP(data: string) {
        if (!isTcpConnected) {
            return
        }
        
        clearSerialBuffer()
        
        // Prepare to send data
        sendATCmd(`AT+CIPSEND=${tcpLinkId},${data.length}`)
        let result = waitAtResponse(">", "ERROR", "FAIL", 2000)
        
        if (result == 1) {
            // Send actual data (no AT prefix needed)
            serial.writeString(data)
            basic.pause(50)
            result = waitAtResponse("SEND OK", "ERROR", "FAIL", 3000)
        }
    }

    /**
     * Close TCP connection
     */
    //% block="Close TCP Connection" advanced=true
    //% weight=75
    //% group="TCP/IP"
    export function closeTCP() {
        sendATCmd(`AT+CIPCLOSE=${tcpLinkId}`)
        waitAtResponse("OK", "ERROR", "FAIL", 2000)
        isTcpConnected = false
    }

    /**
     * Send HTTP GET request
     */
    //% block="HTTP GET|Host %host|Port %port|Path %path"
    //% weight=80
    //% group="TCP/IP"
    //% port.defl=80
    //% path.defl="/"
    export function httpGET(host: string, port: number, path: string) {
        lastHttpStatus = 0
        lastHttpBody = ""
        tcpDataReceived = false
        lastTcpData = ""
        
        connectTCP(host, port)
        basic.pause(500)
        
        if (isTcpConnected) {
            // Clear buffer before sending
            clearSerialBuffer()
            
            let request = `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`
            
            // Send request but don't wait for SEND OK - go straight to reading response
            sendATCmd(`AT+CIPSEND=${tcpLinkId},${request.length}`)
            let result = waitAtResponse(">", "ERROR", "FAIL", 2000)
            
            if (result == 1) {
                // Send actual request data
                serial.writeString(request)
                basic.pause(100)
                
                // Read response immediately after sending
                lastTcpData = readChunkedData(5000)
                
                if (lastTcpData.length > 0) {
                    tcpDataReceived = true
                    lastHttpStatus = parseHttpStatus(lastTcpData)
                    lastHttpBody = parseHttpBody(lastTcpData)
                }
            }
            
            // Close connection
            closeTCP()
        }
    }

    /**
     * Send HTTP POST request with data
     */
    //% block="HTTP POST|Host %host|Port %port|Path %path|Data %data"
    //% weight=75
    //% group="TCP/IP"
    //% port.defl=80
    //% path.defl="/api/data"
    export function httpPOST(host: string, port: number, path: string, data: string) {
        lastHttpStatus = 0
        lastHttpBody = ""
        tcpDataReceived = false
        
        connectTCP(host, port)
        basic.pause(500)
        
        if (isTcpConnected) {
            let request = `POST ${path} HTTP/1.1\r\nHost: ${host}\r\nContent-Type: application/json\r\nContent-Length: ${data.length}\r\nConnection: close\r\n\r\n${data}`
            sendTCP(request)
            basic.pause(1000)
            
            lastTcpData = readChunkedData(5000)
            
            if (lastTcpData.length > 0) {
                tcpDataReceived = true
                lastHttpStatus = parseHttpStatus(lastTcpData)
                lastHttpBody = parseHttpBody(lastTcpData)
            }
            
            closeTCP()
        }
    }

    /**
     * Get last received TCP data (raw)
     */
    //% block="Last TCP Data"
    //% weight=70
    //% group="TCP/IP"
    //% blockSetVariable="tcpData"
    export function getLastTCPData(): string {
        return lastTcpData
    }

    /**
     * Get last HTTP response status code
     */
    //% block="Last HTTP Status"
    //% weight=69
    //% group="TCP/IP"
    //% blockSetVariable="httpStatus"
    export function getLastHttpStatus(): number {
        return lastHttpStatus
    }

    /**
     * Get last HTTP response body
     */
    //% block="Last HTTP Body"
    //% weight=68
    //% group="TCP/IP"
    //% blockSetVariable="httpBody"
    export function getLastHttpBody(): string {
        return lastHttpBody
    }

    /**
     * Check if last HTTP request was successful (status 200-299)
     */
    //% block="HTTP Success"
    //% weight=67
    //% group="TCP/IP"
    export function isHttpSuccess(): boolean {
        return lastHttpStatus >= 200 && lastHttpStatus < 300
    }

    /**
     * Check if TCP data was received
     */
    //% block="TCP Data Received" advanced=true
    //% weight=65
    //% group="TCP/IP"
    export function isTCPDataReceived(): boolean {
        return tcpDataReceived
    }

    /**
     * Clear TCP data buffer
     */
    //% block="Clear TCP Data" advanced=true
    //% weight=60
    //% group="TCP/IP"
    export function clearTCPData() {
        lastTcpData = ""
        tcpDataReceived = false
    }

    /**
     * Start TCP server on specified port
     */
    //% block="Start TCP Server|Port %port" advanced=true
    //% weight=55
    //% group="TCP/IP"
    //% port.defl=8080
    export function startTCPServer(port: number) {
        // Enable multiple connections
        sendATCmd('AT+CIPMUX=1')
        waitAtResponse("OK", "ERROR", "FAIL", 1000)
        
        // Start server
        sendATCmd(`AT+CIPSERVER=1,${port}`)
        let result = waitAtResponse("OK", "ERROR", "FAIL", 2000)
        
        if (result == 1) {
            tcpServerRunning = true
            basic.showString("Server OK", 70)
        } else {
            basic.showString("Server Fail", 70)
        }
    }

    /**
     * Stop TCP server
     */
    //% block="Stop TCP Server" advanced=true
    //% weight=50
    //% group="TCP/IP"
    export function stopTCPServer() {
        sendATCmd('AT+CIPSERVER=0')
        waitAtResponse("OK", "ERROR", "FAIL", 2000)
        tcpServerRunning = false
        basic.showString("Server Stop", 70)
    }

    /**
     * Check if TCP is connected
     */
    //% block="TCP Connected" advanced=true
    //% weight=45
    //% group="TCP/IP"
    //% blockSetVariable="tcpStatus"
    export function isTCPConnected(): boolean {
        return isTcpConnected
    }

    /**
     * Send simple JSON data via HTTP POST
     */
    //% block="Send Sensor Data|Host %host|Port %port|Path %path|Key %key|Value %value"
    //% weight=70
    //% group="TCP/IP"
    //% port.defl=80
    //% path.defl="/api/sensor"
    //% key.defl="temperature"
    export function sendSensorData(host: string, port: number, path: string, key: string, value: string) {
        let jsonData = `{"${key}":"${value}"}`
        httpPOST(host, port, path, jsonData)
    }

}


