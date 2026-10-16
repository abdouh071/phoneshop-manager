export interface SpecItem {
  id: string;
  label: string;
  value: string;
}

export type TicketFormat = '80mm' | '58mm' | 'sticker';
export type TicketPrintMode = 'specs' | 'free_text';
export type TextFontSize = 'auto' | 'normal' | 'large' | 'huge' | 'giant';

export interface CustomTicketData {
  title: string;
  subtitle: string;
  deviceModel: string;
  condition: string;
  storage: string;
  ram: string;
  color: string;
  batteryHealth: string;
  price: string;
  warranty: string;
  imei: string;
  specs: SpecItem[];
  notes: string;
  includeBarcode: boolean;
  barcodeValue: string;
  barcodeType: 'barcode' | 'qr';
  showStoreHeader: boolean;
  showStoreFooter: boolean;
  customFooter: string;
  format: TicketFormat;
  copies: number;
  // Free-text blank sticker mode fields
  mode?: TicketPrintMode;
  freeText?: string;
  fontSize?: TextFontSize;
  isBold?: boolean;
  textAlign?: 'center' | 'left' | 'right';
  showStoreNameOnSticker?: boolean;
  stickerSize?: '50x20' | '50x25' | '50x30';
}
