/*
* pxt-iot-lora node, Micro:Bit library for IoTLoRaNode
* Copyright (C) 2018-2020  Pi Supply
* Changes for Calliope mini 8.5.2020 M. Klein
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
* Last Updated 2020-02-13-1520
*/

let payload = ""
let debugmode = true
//% weight=8 color=#9F79EE icon="\uf1b3" block="IoT-LoRa"
namespace IotLoRaNode {

    function sendLoraAtCmd(cmd: string) {
        led.toggle(4, 0)
        if (debugmode) {
            serial.redirect(SerialPin.USB_TX, SerialPin.USB_RX, BaudRate.BaudRate115200);
            basic.pause(10)
            serial.writeString("CMD:" + cmd + "\r\n")
            serial.redirect(SerialPin.C17, SerialPin.C16, BaudRate.BaudRate9600);
            basic.pause(10)
        }
        serial.writeLine(cmd + "\r\n")
        led.toggle(4, 0)
    }

    function waitAtResponse(target1: string, target2: string, target3: string, timeout: number) {
        let start = input.runningTime()
        let buffer = ""
        let result = 0
        while (input.runningTime() - start < timeout) {
            buffer = "" + buffer + serial.readLine()
            if (buffer.includes(target1)) {
                result = 1
            }
            if (buffer.includes(target2)) {
                result = 2
            }
            if (buffer.includes(target3)) {
                result = 3
            }
            basic.pause(100)
        }
        if (debugmode) {
            serial.redirect(SerialPin.USB_TX, SerialPin.USB_RX, BaudRate.BaudRate115200);
            basic.pause(10)
            serial.writeString("RCV:" + buffer + "\r\n")
            serial.redirect(SerialPin.C17, SerialPin.C16, BaudRate.BaudRate9600);
        }
        basic.pause(10)


        return result
    }

    //%blockId="IotLoRaNode_InitialiseRadioOTAA" block="Initialise LoRa Radio via OTAA:|Device Eui %deveui|App Key %appkey"
    //% block.loc.de="LoRa Radio über OTAA initialisieren:|Geräte Eui %deveui|App Schlüssel %appkey"
    //% blockGap=8
    //% weight=100
    export function InitialiseRadioOTAA(deveui: string, appkey: string): void {
        let status = 0

        // Initialize serial for LoRa module (C16/C17)
        serial.redirect(SerialPin.C17, SerialPin.C16, BaudRate.BaudRate9600);
        serial.setRxBufferSize(64)

        //Set to use LoRaWAN Mode
        sendLoraAtCmd("AT+VER")
        waitAtResponse("VER", "ERROR", "", 100)

        //Set to use LoRaWAN Mode
        sendLoraAtCmd("AT+MODE=LWOTAA")
        waitAtResponse("LWOTAA", "ERROR", "", 100)


        //Set to use LoRaWAN Mode
        sendLoraAtCmd("AT+DR=EU868")
        waitAtResponse("EU868", "ERROR", "", 100)


        //Set to use LoRaWAN Mode
        sendLoraAtCmd("AT+CH=NUM,0-2")
        waitAtResponse("NUM", "", "ERROR", 100)

        //Set to use LoRWAN Mode
        sendLoraAtCmd("AT+CLASS=C")
        waitAtResponse("C", "", "ERROR", 100)


        //Set the application session key
        sendLoraAtCmd("AT+KEY=APPKEY," + appkey)
        waitAtResponse("APPKEY", "", "ERROR", 100)


        //Set the device extended unique identifier
        sendLoraAtCmd("AT+ID=DEVEUI," + deveui)
        waitAtResponse("DevEui", "", "ERROR", 100)

        //Set the device AppEUI
        sendLoraAtCmd("AT+ID=AppEUI," + "8000000000000006") 
        waitAtResponse("AppEui", "", "ERROR", 100)

        //Set the application session key
        sendLoraAtCmd("AT+PORT=8")
        waitAtResponse("8", "", "ERROR", 100)

        let currenttries = 0
        let maxtries = 2
        //Join TTN
        while (status != 1 && currenttries <= maxtries) {

            sendLoraAtCmd("AT+JOIN")
            status = waitAtResponse("joined", "failed", "ERROR", 1000)
            if (status == 1) {
                basic.showString("Connected", 70)
            }
            else if (status != 1) {
                basic.showString("Failed", 70)
                currenttries = currenttries + 1
                basic.pause(3000)
            }
        }

    }


    //%blockId="IotLoRaNode_TransmitMessage" block="Transmit LoRa Data"
    //% block.loc.de="LoRa Daten übertragen"
    //% weight=95
    export function loraTransmitPayload(): void {
        /**
         * Transmit Message
         */
        sendLoraAtCmd("AT+CMSGHEX=" + payload)
        basic.pause(100)
        payload = ""
    }

    //%blockId="IotLoRaNode_DigitalValue"
    //%block="Add Digital Value: %value on channel: %channel"
    //% block.loc.de="Digitalen Wert hinzufügen: %value auf Kanal: %channel"
    //% channel.min=0 channel.max=20
    //% channel.defl=1
    //% weight=50
    export function DigitalValue(value: boolean, channel: number): void {
        /**
         * Add digital value
         */
        let intVal = value ? 1 : 0;
        payload = payload + "0" + channel + "000" + intVal;


    }
    //%blockId="IotLoRaNode_AnalogueValue" block="Add Analogue Value: %value on channel: %channel"
    //% block.loc.de="Analogen Wert hinzufügen: %value auf Kanal: %channel"
    //% value.min=0 value.max=254
    //% channel.min=0 channel.max=20
    //% channel.defl=1
    //% weight=55
    export function AnalogueValue(value: number, channel: number): void {
        /**
         * Add analogue value
         */
        let bufr = pins.createBuffer(2);
        bufr.setNumber(NumberFormat.Int16BE, 0, (value * 100))
        payload = payload + "0" + channel + "02" + bufr.toHex();
    }


    //%blockId="IotLoRaNode_temperatureValue" block="Add Temperature Value: %temperatureVal on channel: %channel"
    //% block.loc.de="Temperaturwert hinzufügen: %temperatureVal auf Kanal: %channel"
    //% channel.min=0 channel.max=20
    //% channel.defl=1
    //% weight=90
    export function TemperatureValue(temperatureVal: number, channel: number): void {
        /**
         * Add temperature value
         */
        let bufr = pins.createBuffer(2);
        bufr.setNumber(NumberFormat.Int16BE, 0, (temperatureVal * 10))
        payload = payload + "0" + channel + "67" + bufr.toHex();


    }

    //%blockId="IotLoRaNode_HumidityValue" block="Add Humidity Value: %humidityVal on channel: %channel"
    //% block.loc.de="Feuchtigkeitswert hinzufügen: %humidityVal auf Kanal: %channel"
    //% channel.min=0 channel.max=20
    //% channel.defl=1
    //% weight=85
    export function HumidityValue(humidityVal: number, channel: number): void {
        /**
         * Add humidity value
         */
        let bufr = pins.createBuffer(1);
        bufr.setNumber(NumberFormat.UInt8BE, 0, (humidityVal * 2))

        payload = payload + "0" + channel + "68" + bufr.toHex();


    }


    //% blockId="IotLoRaNode_barometerValue" block="Add Barometer Value: %barometerVal on channel: %channel"
    //% block.loc.de="Barometerwert hinzufügen: %barometerVal auf Kanal: %channel"
    //% channel.min=0 channel.max=20
    //% channel.defl=1
    //% weight=60
    export function BarometerValue(barometerVal: number, channel: number): void {
        /**
         * Add barometer value
         */
        let bufr = pins.createBuffer(2);
        bufr.setNumber(NumberFormat.Int16BE, 0, (barometerVal * 10))

        payload = payload + "0" + channel + "73" + bufr.toHex();
    }

    //% blockId="IotLoRaNode_PresenceSensor"
    //% block="Add Presence Sensor: %value on channel: %channel"
    //% block.loc.de="Anwesenheitssensor hinzufügen: %value auf Kanal: %channel"
    //% channel.min=0 channel.max=20
    //% channel.defl=1
    //% weight=65
    export function PresenceSensor(value: boolean, channel: number): void {
        /**
         * Add presence value
         */
        let intVal = value ? 1 : 0;
        payload = payload + "0" + channel + "660" + intVal;
    }

    //% blockId="IotLoRaNode_AccelorometerValue" block="Add Accelerometer Values |X %accelValX|Y %accelValY|Z %accelValZ on channel %channel"
    //% block.loc.de="Beschleunigungsmesser-Werte hinzufügen |X %accelValX|Y %accelValY|Z %accelValZ auf Kanal %channel"
    //% channel.min=0 channel.max=20
    //% channel.defl=1
    //% weight=75
    export function AccelorometerValue(accelValX: number, accelValY: number, accelValZ: number, channel: number): void {
        /**
         * Add accelorometer
         */
        let bufr = pins.createBuffer(6);
        bufr.setNumber(NumberFormat.Int16BE, 0, (accelValX * 100))
        bufr.setNumber(NumberFormat.Int16BE, 2, (accelValY * 100))
        bufr.setNumber(NumberFormat.Int16BE, 4, (accelValZ * 100))

        payload = payload + "0" + channel + "71" + bufr.toHex();
    }

    //% blockId="IotLoRaNode_LightValue" block="Add light Value: %lightVal on channel: %channel"
    //% block.loc.de="Lichtwert hinzufügen: %lightVal auf Kanal: %channel"
    //% channel.min=0 channel.max=20
    //% channel.defl=1
    //% weight=80
    export function LightValue(lightVal: number, channel: number): void {
        /**
         * Add light value
         */
        let bufr = pins.createBuffer(2);
        bufr.setNumber(NumberFormat.Int16BE, 0, (lightVal))

        payload = payload + "0" + channel + "65" + bufr.toHex();
    }

    //% blockId="IotLoRaNode_GPS" block="Add GPS Value - |Latitude: %latitude |Longitude %longitude |Altitude %altitude on channel: %channel"
    //% block.loc.de="GPS-Wert hinzufügen - |Breitengrad: %latitude |Längengrad %longitude |Höhe %altitude auf Kanal: %channel"
    //% blockGap=8
    //% channel.min=0 channel.max=20
    //% channel.defl=1
    //% weight=70
    export function GPS(latitude: number, longitude: number, altitude: number, channel: number): void {
        /**
         * Add GPS value
         */
        let latBuf = pins.createBuffer(4);
        latBuf.setNumber(NumberFormat.Int32BE, 0, longitude * 10000)
        let latBuf2 = latBuf.slice(1, 4);

        let lonBuf = pins.createBuffer(4);
        lonBuf.setNumber(NumberFormat.Int32BE, 0, latitude * 10000)
        let lonBuf2 = lonBuf.slice(1, 4);
        let altBuf = pins.createBuffer(4);
        altBuf.setNumber(NumberFormat.Int32BE, 0, altitude * 100)
        let altBuf2 = altBuf.slice(1, 4);
        payload = "" + payload + "0" + channel + "88" + lonBuf2.toHex() + latBuf2.toHex() + altBuf2.toHex()
    }

}