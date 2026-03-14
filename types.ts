export interface UserProfile {
  profession: string;
  city: string;
  investments: string;
  interests: string;
}

export interface NewsSource {
  title: string;
  uri: string;
}

export enum AppState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  isFinal: boolean;
  timestamp: number;
  sources?: NewsSource[];
}