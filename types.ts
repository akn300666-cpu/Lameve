
export interface Message {
  id: string;
  role: 'user' | 'model' | 'system'; // Added system role for local LLM context
  text: string;
  image?: string; // Base64 string for images displayed in chat
  isError?: boolean;
  isImageLoading?: boolean;
}

export type Language = 'english' | 'manglish';

export interface EveConfig {
  voiceEnabled: boolean;
  personality: 'default' | 'bananafy';
}

export interface ApiKeyDef {
  id: string;
  label: string;
  key: string;
}

export interface GenerationSettings {
  // Image Gen Settings
  guidance: number;
  steps: number;
  ipAdapterStrength: number;
  loraStrength: number;
  seed: number;
  randomizeSeed: boolean;
  useMagic: boolean;
  aiImageGeneration: boolean;
  // Chat Model Settings
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  // Local LLM Settings
  localLlmUrl: string;
  localModelName: string;
}

export interface EveResponse {
  text: string;
  visualPrompt?: string;
  visualType?: 'scene' | 'selfie';
  image?: string;
  enhancedPrompt?: string;
  isError?: boolean;
  errorMessage?: string;
  errorType?: string;
}
