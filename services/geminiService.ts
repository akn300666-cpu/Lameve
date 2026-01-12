
import { EVE_SYSTEM_INSTRUCTION } from '../constants';
import { Message, GenerationSettings, EveResponse, Language } from '../types';

// --- OLLAMA API CLIENT ---

const callOllama = async (
    messages: { role: string; content: string }[],
    model: string,
    url: string,
    settings: GenerationSettings
): Promise<string> => {
    try {
        let baseUrl = url.trim();
        if (!baseUrl) baseUrl = "http://127.0.0.1:11434";
        
        // Remove trailing slash
        baseUrl = baseUrl.replace(/\/$/, "");
        
        // Robust URL construction: 
        // If the user provided the full endpoint, use it. Otherwise, add /api/chat
        let targetUrl = baseUrl;
        if (!targetUrl.endsWith('/api/chat')) {
            // Check if it at least has the port or base domain
            targetUrl = `${baseUrl}/api/chat`;
        }

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                stream: false,
                options: {
                    temperature: settings.temperature,
                    top_p: settings.topP,
                    top_k: settings.topK,
                    repeat_penalty: settings.repeatPenalty,
                    num_ctx: 4096 // Ensure a decent context window
                }
            })
        });

        if (response.status === 404) {
            throw new Error(`Model '${model}' not found. Try running: ollama pull ${model}`);
        }

        if (!response.ok) {
            const errorText = await response.text();
            let parsedError;
            try { parsedError = JSON.parse(errorText); } catch(e) {}
            throw new Error(parsedError?.error || `Ollama Error ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return data.message?.content || "";
    } catch (error: any) {
        console.error("Ollama connection failed:", error);
        if (error.message.includes('Failed to fetch')) {
            throw new Error("Cannot reach Ollama. Is it running? (Check OLLAMA_ORIGINS=*)");
        }
        throw error;
    }
};

// --- GRADIO IMAGE GENERATION ---

const generateWithGradio = async (
    prompt: string, 
    endpoint: string | null | undefined,
    settings: GenerationSettings
): Promise<string> => {
    if (!endpoint || endpoint.trim() === '') {
        throw new Error("Gradio URL missing.");
    }

    try {
        const { Client } = await import("https://esm.sh/@gradio/client");
        const client = await Client.connect(endpoint);
        
        const truncatedPrompt = prompt.length > 240 ? prompt.substring(0, 240) : prompt;
        
        const result = await client.predict(0, [ 
            truncatedPrompt,
            "", // neg_prompt
            null, // upload_ref
            parseFloat(String(settings.ipAdapterStrength)),
            parseFloat(String(settings.guidance)),
            parseInt(String(settings.steps), 10),
            parseInt(String(settings.seed), 10),
            Boolean(settings.randomizeSeed)
        ]);

        const data = result.data as any[];
        if (data && data.length > 0) {
            const item = data[0];
            if (item?.url) return item.url;
            if (typeof item === 'string') return item;
        }
        throw new Error("No image returned.");
    } catch (e: any) { 
        console.error("Gradio failed:", e);
        throw new Error("Image gen failed.");
    }
};

export const summarizeHistory = async (
    history: Message[],
    settings: GenerationSettings,
    existingMemory: string
): Promise<string> => {
    const conversationText = history
        .map(msg => `${msg.role.toUpperCase()}: ${msg.text}`)
        .join("\n");

    const systemPrompt = `Summarize the following conversation into a concise list of key facts about 'ak' and their relationship with EVE. Merge with existing memory.
    
    Existing Memory:
    ${existingMemory || "None"}
    `;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Summarize:\n\n${conversationText}` }
    ];

    try {
        return await callOllama(messages, settings.localModelName, settings.localLlmUrl, settings);
    } catch (e) {
        console.error("Summary failed:", e);
        throw new Error("Failed to consolidate memory.");
    }
};

export const sendMessageToEve = async (
  message: string, 
  history: Message[],
  attachmentBase64: string | undefined, 
  forceImageGeneration: boolean = false, 
  apiKey: string | undefined, 
  gradioEndpoint: string | null | undefined,
  genSettings: GenerationSettings,
  previousVisualContext: string = "", 
  language: Language = 'english',
  longTermMemory: string = ""
): Promise<EveResponse> => {

  try {
    let finalSystemInstruction = EVE_SYSTEM_INSTRUCTION;
    if (longTermMemory && longTermMemory.trim() !== "") {
        finalSystemInstruction += `\n\n[CORE MEMORY]:\n${longTermMemory}`;
    }

    const apiMessages: { role: string; content: string }[] = [
        { role: 'system', content: finalSystemInstruction }
    ];

    history.forEach(msg => {
        if (!msg.isError && msg.text) {
            apiMessages.push({ 
                role: msg.role === 'model' ? 'assistant' : 'user', 
                content: msg.text 
            });
        }
    });

    apiMessages.push({ role: 'user', content: message });

    let responseText = await callOllama(apiMessages, genSettings.localModelName, genSettings.localLlmUrl, genSettings);
    responseText = responseText.trim();

    if (responseText.includes("!IMG:")) {
        const parts = responseText.split("!IMG:");
        const textPart = parts[0].trim();
        const visualDescription = parts[1].trim();
        
        try {
            const cleanPrompt = visualDescription.replace(/^\[|\]$/g, '');
            const imageUrl = await generateWithGradio(cleanPrompt, gradioEndpoint, genSettings);
            return { text: textPart || "Look at this.", image: imageUrl, visualPrompt: cleanPrompt };
        } catch (imgError: any) {
             return { text: textPart + "\n\n(Visual synthesis failed.)", isError: false };
        }
    }

    return { text: responseText };

  } catch (error: any) {
    return { 
        text: "My connection is unstable...", 
        isError: true, 
        errorMessage: error.message || "Unknown error", 
        errorType: 'GENERAL' 
    };
  }
};
