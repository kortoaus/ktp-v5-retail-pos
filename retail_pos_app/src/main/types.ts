export interface ServerConfig {
  host: string;
  port: number;
}

export type ScaleType = "CAS" | "DATALOGIC";

export interface ScaleConfig {
  type: ScaleType;
  path: string;
  baudRate: number; // most: 9600
  dataBits: number; // most: 7
  stopBits: number; // most: 1
  parity: "none" | "even" | "odd" | "mark" | "space"; // most: even
}

export type LabelLanguage = "zpl" | "slcs";
export type MediaSize = "7030" | "7090";
export type EscposSerialParity = "none" | "even" | "odd" | "mark" | "space";
export type EscposSerialHandshaking = "none" | "dtr-dsr" | "rts-cts" | "xon-xoff";
export type ReceiptPrintMode = "raster" | "escpos";
export type ReceiptTextEncoding = "ascii-replace" | "cp949" | "euc-kr";

export interface EscposSerialSettings {
  baudRate: number;
  dataBits: 7 | 8;
  parity: EscposSerialParity;
  stopBits: 1 | 2;
  handshaking: EscposSerialHandshaking;
  dtr: boolean;
  rts: boolean;
}

export interface ZplNetConfig {
  name: string;
  host: string;
  port: number;
  language: LabelLanguage;
  mediaSize?: MediaSize;
}

export interface ZplSerialConfig {
  name: string;
  path: string;
  language: LabelLanguage;
  mediaSize?: MediaSize;
}

export type EscposPrinterConfig =
  | {
      type: "net";
      host: string;
      port: number;
    }
  | ({
      type: "serial";
      path: string;
    } & EscposSerialSettings);

export interface EscposPrintRequest {
  printer: Extract<EscposPrinterConfig, { type: "serial" }>;
  data: number[];
}

export interface EscposModemStatus {
  cts: boolean;
  dsr: boolean;
  dcd: boolean;
}

export interface EscposControlLineMatrixEntry {
  label: string;
  dtr: boolean;
  rts: boolean;
  status: EscposModemStatus | null;
  ok: boolean;
  message: string;
}

export interface EscposControlLineMatrixRequest extends EscposPrintRequest {}

export interface EscposControlLineMatrixResult {
  ok: boolean;
  message: string;
  entries: EscposControlLineMatrixEntry[];
}

export interface DeviceConfig {
  scale: ScaleConfig | null;
  zplSerial: ZplSerialConfig[];
  zplNet: ZplNetConfig[];
  escposPrinter: EscposPrinterConfig | null;
  receiptPrintMode: ReceiptPrintMode;
  receiptTextEncoding: ReceiptTextEncoding;
}

export interface AppConfig {
  server: ServerConfig | null;
  devices: DeviceConfig;
}

export type SLCSPart =
  | {
      type: "raw" | "euc-kr";
      data: string;
    }
  | {
      type: "bytes";
      data: number[];
    };

export type LabelOutput =
  | { language: "zpl"; data: string }
  | { language: "slcs"; parts: SLCSPart[] };

export interface LabelSendRequest {
  printer: {
    type: "serial" | "net";
    path?: string;
    host?: string;
    port?: number;
  };
  label: LabelOutput;
}

export interface WeightResult {
  weight: number;
  unit: "kg" | "lb" | "oz" | "g";
  status: "stable" | "unstable" | "error" | "disconnected";
  message?: string;
}
