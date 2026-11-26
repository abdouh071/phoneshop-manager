import type { CustomTicketData } from './customTicketTypes';

export interface UserTemplate {
  id: string;
  name: string;
  data: CustomTicketData;
}

export interface StickerOverflowWarning {
  isOverflow: boolean;
  lineCount: number;
  clippedLines?: number;
  maxEstimatedLines: number;
  stickerSize: '50x20' | '50x25' | '50x30';
}
