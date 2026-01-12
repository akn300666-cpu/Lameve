
import { Message, ApiKeyDef, GenerationSettings, Language } from './types';

const DB_NAME = 'EveVaultDB';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const GLOBAL_SESSION_KEY = 'global_session'; // Fixed key for the single session

const KEYS_STORAGE_KEY = 'eve_api_keys';
const ACTIVE_KEY_ID_STORAGE_KEY = 'eve_active_key_id';
const GRADIO_URL_STORAGE_KEY = 'eve_gradio_url';
const GEN_SETTINGS_STORAGE_KEY = 'eve_gen_settings';
const LANGUAGE_STORAGE_KEY = 'eve_language';

interface StoredSession {
  messages: Message[];
  lastUpdated: number;
}

// --- INDEXEDDB HELPERS ---

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event: Event) => {
      const req = event.target as IDBRequest;
      console.error("[IDB] IndexedDB open error:", req.error);
      reject(req.error);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const saveSession = async (messages: Message[]) => {
  let db: IDBDatabase | null = null;
  try {
    db = await initDB();
    const data = { id: GLOBAL_SESSION_KEY, messages, lastUpdated: Date.now() };
    
    return new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction([STORE_NAME], 'readwrite');
      
      transaction.oncomplete = () => {
        if (db) db.close();
        resolve();
      };
      
      transaction.onerror = (event: Event) => {
        const tx = event.target as IDBTransaction;
        if (db) db.close();
        reject(tx.error);
      };

      const store = transaction.objectStore(STORE_NAME);
      store.put(data);
    });
  } catch (e) {
    if (db) db.close();
    throw e;
  }
};

export const loadSession = async (): Promise<StoredSession | null> => {
  let db: IDBDatabase | null = null;
  try {
    db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db!.transaction([STORE_NAME], 'readonly');
      
      transaction.oncomplete = () => {
        if (db) db.close();
      };

      transaction.onerror = (event: Event) => {
        if (db) db.close();
        reject(new Error("Load transaction failed"));
      };

      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(GLOBAL_SESSION_KEY);
      
      request.onsuccess = () => {
        resolve(request.result as StoredSession);
      };
    });
  } catch (e) {
    if (db) db.close();
    return null;
  }
};

export const clearSession = async () => {
  let db: IDBDatabase | null = null;
  try {
    db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    transaction.oncomplete = () => {
        if (db) db.close();
    };
    const store = transaction.objectStore(STORE_NAME);
    store.delete(GLOBAL_SESSION_KEY);
  } catch (e) {
    if (db) db.close();
    throw e;
  }
};

export const restoreFromBackup = async (data: StoredSession): Promise<void> => {
  await saveSession(data.messages);
};

// --- LANGUAGE PREFERENCE ---

export const saveLanguage = (language: Language) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
};

export const loadLanguage = (): Language => {
    const lang = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (lang === 'english' || lang === 'manglish') {
        return lang;
    }
    return 'english';
};

// --- GRADIO ENDPOINT STORAGE ---

export const saveGradioEndpoint = (url: string) => {
    localStorage.setItem(GRADIO_URL_STORAGE_KEY, url.trim()); 
};

export const loadGradioEndpoint = (): string | null => {
    const url = localStorage.getItem(GRADIO_URL_STORAGE_KEY);
    return url === '' ? null : url;
};

// --- GENERATION SETTINGS STORAGE ---

export const GenerationSettingsDefaults: GenerationSettings = {
    guidance: 7.0,
    steps: 30,
    ipAdapterStrength: 0.6,
    loraStrength: 0.45, 
    seed: 42,
    randomizeSeed: true,
    useMagic: true,
    aiImageGeneration: true, 
    temperature: 1.0,
    topP: 0.95,
    topK: 40,
    repeatPenalty: 1.1,
    localLlmUrl: 'http://localhost:11434/api/chat',
    localModelName: 'mannix/llama3.1-8b-abliterated:latest'
};

export const saveGenerationSettings = (settings: GenerationSettings) => {
    localStorage.setItem(GEN_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};

export const loadGenerationSettings = (): GenerationSettings => {
    const raw = localStorage.getItem(GEN_SETTINGS_STORAGE_KEY);
    if (raw) {
        return { ...GenerationSettingsDefaults, ...JSON.parse(raw) };
    }
    return GenerationSettingsDefaults;
};
