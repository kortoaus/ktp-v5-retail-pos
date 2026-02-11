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

export interface ZplNetConfig {
  name: string;
  host: string;
  port: number;
  language: LabelLanguage;
}

export interface ZplSerialConfig {
  path: string;
  language: LabelLanguage;
}

export interface EscposPrinterConfig {
  host: string;
  port: number;
}

export interface DeviceConfig {
  scale: ScaleConfig | null;
  zplSerial: ZplSerialConfig | null;
  zplNet: ZplNetConfig[];
  escposPrinter: EscposPrinterConfig | null;
}

export interface AppConfig {
  server: ServerConfig | null;
  devices: DeviceConfig;
}

export interface SLCSPart {
  type: "raw" | "euc-kr";
  data: string;
}

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
