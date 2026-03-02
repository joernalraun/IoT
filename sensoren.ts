enum DistanceUnit {
    //% block="cm"
    cm = 1,
    //% block="inch"
    inch = 2,
};

//% weight=10 color=#9F79EE icon="\uf1b3" block="IoT-Sensoren"
namespace grove {
    function Read(aht20: grove.sensors.AHT20): { Humidity: number, Temperature: number } {
        if (!aht20.GetState().Calibrated) {
            aht20.Initialization();
            if (!aht20.GetState().Calibrated) return null;
        }

        aht20.TriggerMeasurement();
        for (let i = 0; ; ++i) {
            if (!aht20.GetState().Busy) break;
            if (i >= 500) return null;
            basic.pause(10);
        }

        return aht20.Read();
    }

    /**
     * Read the temperature(°C) from Grove-AHT20(SKU#101990644)
     */
    //% group="AHT20"
    //% block="[Grove - Temp&Humi Sensor]|Read the temperature(°C))"
    //% block.loc.de="Temperature in °C"
    //% weight=40
    export function aht20ReadTemperatureC(): number {
        const aht20 = new grove.sensors.AHT20();
        const val = Read(aht20);
        if (val == null) return null;

        return Math.round(val.Temperature * 1000) / 1000;   // vorher val.Temperature;

    }


    /**
     * Read the humidity from Grove-AHT20(SKU#101990644)
     */
    //% group="AHT20"
    //% block="[Grove - Temp&Humi Sensor]|Read the humidity"
    //% block.loc.de="Feuchtigkeit in Prozent"
    //% weight=39
    export function aht20ReadHumidity(): number {
        const aht20 = new grove.sensors.AHT20();
        const val = Read(aht20);
        if (val == null) return null;

        return Math.round(val.Humidity * 1000) / 1000; //vorher return val.humidity

    }

    let distanceBackup: number = 0;
    //% blockId=grove_ultrasonic_centimeters
    //% block="Distance|%pin|%unit"
    //% block.loc.de="Entfernung|%pin|%unit"
    //% pin.fieldEditor="gridpicker" pin.fieldOptions.columns=4
    //% pin.fieldOptions.tooltips="false" pin.fieldOptions.width="250"
    //% group="Ultraschall" group.loc.de="Ultraschall" pin.defl=DigitalPin.C16
    //% weight=30
    export function measureDistance(pin: DigitalPin, unit: DistanceUnit): number {
        let duration = 0;
        let range = 0;
        const boardVersionDivider = ((control.ramSize() > 64000) ? 44 : 29); // CODAL = 44, DAL = 29
        const distanceUnitDivider = (unit == DistanceUnit.cm ? 1 : 2.54); // cm = 1, inch = 2.54

        pins.digitalWritePin(pin, 0);
        control.waitMicros(2);
        pins.digitalWritePin(pin, 1);
        control.waitMicros(20);
        pins.digitalWritePin(pin, 0);
        duration = pins.pulseIn(pin, PulseValue.High, 50000); // Max duration 50 ms

        range = Math.round(duration * 153 / boardVersionDivider / 2 / 100 / distanceUnitDivider);

        if (range > 0) distanceBackup = range;
        else range = distanceBackup;

        basic.pause(50);

        return range;
    }

    /**
     * Read the values of the moisture sensor in percent
     * @param pin signal pin of moisture sensor module
     */
    //% blockId=grove_Moisture block="Moisture Sensor at %pin"
    //% pin.fieldEditor="gridpicker" pin.fieldOptions.columns=4
    //% pin.fieldOptions.tooltips="false" pin.fieldOptions.width="250"
    //% group="Boden Feuchtigkeit" group.loc.de="Boden-Feuchtigkeit" pin.defl=AnalogPin.C16
    //% weight=35
    //% block.loc.de="Feuchtigkeit|%pin"
    export function measureMoisture(pin: AnalogPin): number {
        let percentValue = pins.analogReadPin(pin);
        return Math.round(percentValue);
    }



    // Protokollbeschreibung des Sensors
    // https://www.sensirion.com/fileadmin/user_upload/customers/sensirion/Dokumente/9.5_CO2/Sensirion_CO2_Sensors_SCD30_Interface_Description.pdf

    //let data = pins.createBuffer(2)
    //data[0] = 0xBE
    //data[1] = 0xEF
    //hier muss die Dezimalzahl 146 rauskommen!
    //    CRC(0xBEEF) = 0x92
    //data[0] ist immer das höchste Byte!
    //console.log("::"+crc(data)+"-"+0x92)
    function crc(data: Buffer, offset: number = 0): number {
        let current_byte;
        let crc = pins.createBuffer(1)
        crc.setNumber(NumberFormat.UInt8LE, 0, 0xFF)
        let crc_bit;

        //calculates 8-Bit checksum with given polynomial 
        for (current_byte = offset; current_byte < offset + 2; ++current_byte) {
            crc.setNumber(NumberFormat.UInt8LE, 0, crc.getNumber(NumberFormat.UInt8LE, 0) ^ data.getNumber(NumberFormat.UInt8LE, current_byte))
            for (crc_bit = 8; crc_bit > 0; --crc_bit) {
                if (crc.getNumber(NumberFormat.UInt8LE, 0) & 0x80)
                    crc.setNumber(NumberFormat.UInt8LE, 0, (crc.getNumber(NumberFormat.UInt8LE, 0) << 1) ^ 0x31)
                else
                    crc.setNumber(NumberFormat.UInt8LE, 0, (crc.getNumber(NumberFormat.UInt8LE, 0) << 1))
            }
        }
        return crc.getNumber(NumberFormat.UInt8LE, 0);
    }

    let temperature: number = 0
    let humidity: number = 0
    let co2: number = 0

    control.inBackground(() => {
        enableContinuousMeasurement()
        while (true) {
            readMeasurement()
            basic.pause(2000)
        }
    })

    function enableContinuousMeasurement(): void {
        let commandBuffer = pins.createBuffer(5)

        //command
        commandBuffer[0] = 0x00
        commandBuffer[1] = 0x10
        //pressure in mBar
        //200m = 987mBar = 0x03DB
        commandBuffer[2] = 0x03 //MSB 
        commandBuffer[3] = 0xDB //LSB
        commandBuffer[4] = crc(commandBuffer, 2)

        pins.i2cWriteBuffer(0x61, commandBuffer, false)
    }
    
    /**
     * Calibrates sensor to 400ppm
     */
    //% group="SCD30"
    //% weight=87 blockGap=8
    //% block="setCalibration400ppm" 
    //% block.loc.de="kalibriere den Sensor auf 400ppm"
    //% blockId=setCalibration400ppm
    //% weight=15
    export function setCalibration400ppm(): void {
        let commandBuffer = pins.createBuffer(5)

        //command
        commandBuffer[0] = 0x52
        commandBuffer[1] = 0x04
        //pressure in mBar
        //200m = 987mBar = 0x03DB
        commandBuffer[2] = 0x01 //MSB 
        commandBuffer[3] = 0x90 //LSB
        commandBuffer[4] = crc(commandBuffer, 2)

        pins.i2cWriteBuffer(0x61, commandBuffer, false)
    }

    /**
     * read calibration data
     */
    //% group="SCD30"
    //% weight=87 blockGap=8
    //% block="getCalibration" 
    //% block.loc.de="Kalibrierungswert anzeigen"
    //% blockId=getCalibration
    //% weight=16
    export function getCalibration(): number {
        let buf = pins.createBuffer(3)
        pins.i2cWriteNumber(0x61, 0x5204, NumberFormat.UInt16BE, false)
        basic.pause(10)
        buf = pins.i2cReadBuffer(0x61, 3, false)
        let res = (buf[0] << 8) + buf[1]
        return res
    }
    /**
     * read sensor version
     */
    //% group="SCD30"
    //% weight=87 blockGap=8
    //% block="getVersion"
    //% block.loc.de="Sensor-Version"
    //% blockId=getVersion
    //% weight=14
    export function getVersion(): string {
        let buf = pins.createBuffer(3)
        pins.i2cWriteNumber(0x61, 0xD100, NumberFormat.UInt16BE, false)
        basic.pause(10)
        buf = pins.i2cReadBuffer(0x61, 3, false)
        let res = "" + buf[0] + "." + buf[1]
        return res
    }

    function readReady(): boolean {
        let buf = pins.createBuffer(3)
        pins.i2cWriteNumber(0x61, 0x0202, NumberFormat.UInt16BE, false)
        basic.pause(10)
        buf = pins.i2cReadBuffer(0x61, 3, false)
        let res = (buf[0] << 8) + buf[1]

        if (buf[1] == 1) {
            return true
        } else {
            return false
        }
    }

    function readMeasurement(): void {
        while (readReady() == false) {
            basic.pause(10)
            //serial.writeLine("waiting in: readMeasurement()")
        }
        let buf = pins.createBuffer(18)
        let tbuf = pins.createBuffer(4)
        pins.i2cWriteNumber(0x61, 0x0300, NumberFormat.UInt16BE, false)
        basic.pause(10)
        buf = pins.i2cReadBuffer(0x61, 18, false)

        //co2
        tbuf.setNumber(NumberFormat.Int8LE, 0, buf.getNumber(NumberFormat.UInt8LE, 0))
        tbuf.setNumber(NumberFormat.Int8LE, 1, buf.getNumber(NumberFormat.UInt8LE, 1))
        tbuf.setNumber(NumberFormat.Int8LE, 3, buf.getNumber(NumberFormat.UInt8LE, 3))
        tbuf.setNumber(NumberFormat.Int8LE, 4, buf.getNumber(NumberFormat.UInt8LE, 4))
        co2 = tbuf.getNumber(NumberFormat.Float32BE, 0)
        co2 = Math.round(co2 * 100) / 100

        //temperature
        tbuf.setNumber(NumberFormat.Int8LE, 0, buf.getNumber(NumberFormat.UInt8LE, 6))
        tbuf.setNumber(NumberFormat.Int8LE, 1, buf.getNumber(NumberFormat.UInt8LE, 7))
        tbuf.setNumber(NumberFormat.Int8LE, 3, buf.getNumber(NumberFormat.UInt8LE, 9))
        tbuf.setNumber(NumberFormat.Int8LE, 4, buf.getNumber(NumberFormat.UInt8LE, 10))
        temperature = tbuf.getNumber(NumberFormat.Float32BE, 0)
        temperature = Math.round(temperature * 100) / 100

        //humidity
        tbuf.setNumber(NumberFormat.Int8LE, 0, buf.getNumber(NumberFormat.UInt8LE, 12))
        tbuf.setNumber(NumberFormat.Int8LE, 1, buf.getNumber(NumberFormat.UInt8LE, 13))
        tbuf.setNumber(NumberFormat.Int8LE, 3, buf.getNumber(NumberFormat.UInt8LE, 15))
        tbuf.setNumber(NumberFormat.Int8LE, 4, buf.getNumber(NumberFormat.UInt8LE, 16))
        humidity = tbuf.getNumber(NumberFormat.Float32BE, 0)
        humidity = Math.round(humidity * 100) / 100
    }

    /**
     * Reads CO2
     */
    //% group="SCD30"
    //% weight=87 blockGap=8
    //% block="Read CO2" 
    //% block.loc.de="CO2 Wert"
    //% blockId=read_CO2
    //% weight=20
    export function readCO2(): number {
        return co2
    }

    /**
     * Reads Temperature
     */
    //% group="SCD30"
    //% weight=87 blockGap=8
    //% block="Read Temperature"
    //% block.loc.de="Temperatur"
    //% blockId=read_Temperature
    //% weight=19
    export function readTemperature(): number {
        return temperature
    }

    /**
     * Reads Humidity
     */
    //% group="SCD30"
    //% weight=87 blockGap=8
    //% block="Read Humidity" 
    //% block.loc.de="Luftfeuchtigkeit"
    //% blockId=read_Humidity
    //% weight=18
    export function readHumidity(): number {
        return humidity
    }
    
    export namespace sensors {

        export class AHT20 {
            public constructor(address: number = 0x38) {
                this._Address = address;
            }

            public Initialization(): AHT20 {
                const buf = pins.createBuffer(3);
                buf[0] = 0xbe;
                buf[1] = 0x08;
                buf[2] = 0x00;
                pins.i2cWriteBuffer(this._Address, buf, false);
                basic.pause(10);

                return this;
            }

            public TriggerMeasurement(): AHT20 {
                const buf = pins.createBuffer(3);
                buf[0] = 0xac;
                buf[1] = 0x33;
                buf[2] = 0x00;
                pins.i2cWriteBuffer(this._Address, buf, false);
                basic.pause(80);

                return this;
            }

            public GetState(): { Busy: boolean, Calibrated: boolean } {
                const buf = pins.i2cReadBuffer(this._Address, 1, false);
                const busy = buf[0] & 0x80 ? true : false;
                const calibrated = buf[0] & 0x08 ? true : false;

                return { Busy: busy, Calibrated: calibrated };
            }

            public Read(): { Humidity: number, Temperature: number } {
                const buf = pins.i2cReadBuffer(this._Address, 7, false);

                const crc8 = AHT20.CalcCRC8(buf, 0, 6);
                if (buf[6] != crc8) return null;

                const humidity = ((buf[1] << 12) + (buf[2] << 4) + (buf[3] >> 4)) * 100 / 1048576;
                const temperature = (((buf[3] & 0x0f) << 16) + (buf[4] << 8) + buf[5]) * 200 / 1048576 - 50;

                return { Humidity: humidity, Temperature: temperature };
            }

            private _Address: number;

            private static CalcCRC8(buf: Buffer, offset: number, size: number): number {
                let crc8 = 0xff;
                for (let i = 0; i < size; ++i) {
                    crc8 ^= buf[offset + i];
                    for (let j = 0; j < 8; ++j) {
                        if (crc8 & 0x80) {
                            crc8 <<= 1;
                            crc8 ^= 0x31;
                        }
                        else {
                            crc8 <<= 1;
                        }
                        crc8 &= 0xff;
                    }
                }

                return crc8;
            }

        }
    }
}