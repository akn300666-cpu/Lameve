
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
        // Default to localhost if no URL provided, ensuring /api/chat is appended if missing (basic check)
        let targetUrl = url;
        if (!targetUrl) targetUrl = "http://127.0.0.1:11434/api/chat";
        if (!targetUrl.endsWith('/api/chat') && !targetUrl.endsWith('/chat')) {
             // If user just put the base URL
             targetUrl = targetUrl.replace(/\/$/, "") + "/api/chat";
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
                    repeat_penalty: settings.repeatPenalty
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.message?.content || "";
    } catch (error: any) {
        console.error("Ollama connection failed:", error);
        throw new Error("Could not connect to local Llama. Is Ollama running?");
    }
};

// --- GRADIO IMAGE GENERATION ---

const generateWithGradio = async (
    prompt: string, 
    endpoint: string | null | undefined,
    settings: GenerationSettings
): Promise<string> => {
    if (!endpoint || endpoint.trim() === '') {
        throw new Error("Gradio URL is missing in settings.");
    }

    try {
        // Dynamic import for client-side usage
        const { Client } = await import("https://esm.sh/@gradio/client");
        const client = await Client.connect(endpoint);
        
        // Matching the Python Script inputs:
        // inputs=[prompt, neg_prompt, upload_ref, ip_scale, guidance, steps, seed, randomize_seed]
        
        const neg_prompt = "";
        const upload_ref = null; // We are generating from text description (Selfie feature)
        
        // Truncate prompt to approx 60 tokens (using 4 chars per token estimation = 240 chars)
        const truncatedPrompt = prompt.length > 240 ? prompt.substring(0, 240) : prompt;
        
        const result = await client.predict(0, [ 
            truncatedPrompt,                                // prompt
            neg_prompt,                                     // neg_prompt
            upload_ref,                                     // upload_ref
            parseFloat(String(settings.ipAdapterStrength)), // ip_scale
            parseFloat(String(settings.guidance)),          // guidance
            parseInt(String(settings.steps), 10),           // steps
            parseInt(String(settings.seed), 10),            // seed
            Boolean(settings.randomizeSeed)                 // randomize_seed
        ]);

        const data = result.data as any[];
        // The python script returns [output_img, status]
        if (data && data.length > 0) {
            const item = data[0];
            if (item?.url) return item.url;
            if (typeof item === 'string') return item;
        }
        throw new Error("No image URL returned from Gradio.");
    } catch (e: any) { 
        console.error("Gradio generation failed:", e);
        throw new Error("Failed to generate image via Gradio.");
    }
};

// --- SUMMARIZATION ---

export const summarizeHistory = async (
    history: Message[],
    settings: GenerationSettings,
    existingMemory: string
): Promise<string> => {
    // Convert history to text format
    const conversationText = history
        .map(msg => `${msg.role.toUpperCase()}: ${msg.text}`)
        .join("\n");

    const systemPrompt = `You are a memory consolidation engine. Your task is to summarize the provided conversation history into a concise list of key facts, events, user preferences, and relationship dynamics. 
    
    If an Existing Memory is provided, merge new information into it.
    
    Rules:
    1. Keep it concise.
    2. Focus on facts that are important for future continuity (names, likes/dislikes, major topics discussed).
    3. Do not include 'Hello' or small talk unless it reveals personality.
    4. Output ONLY the summary text.
    
    Existing Memory:
    ${existingMemory || "None"}
    `;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Summarize this conversation:\n\n${conversationText}` }
    ];

    try {
        const modelName = settings.localModelName || "llama3.1";
        const summary = await callOllama(messages, modelName, settings.localLlmUrl, settings);
        return summary;
    } catch (e) {
        console.error("Summarization failed:", e);
        throw new Error("Failed to summarize memories.");
    }
};


// --- MAIN CHAT FUNCTION ---

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
    // 1. Prepare Chat History for Ollama
    
    // Construct System Instruction with Memory Injection
    let finalSystemInstruction = EVE_SYSTEM_INSTRUCTION;
    if (longTermMemory && longTermMemory.trim() !== "") {
        finalSystemInstruction += `\n\n[CORE MEMORY / CONTEXT]:\n${longTermMemory}\n\nUse this memory to maintain continuity, but do not explicitly mention 'I remember from my memory file'. Just know these things.`;
    }

    const apiMessages: { role: string; content: string }[] = [
        { role: 'system', content: finalSystemInstruction }
    ];

    // Map existing history
    history.forEach(msg => {
        if (!msg.isError) {
            // Ollama uses 'assistant' for the model role
            const role = msg.role === 'model' ? 'assistant' : 'user';
            // Only add text messages to history for Llama 3 text model
            if (msg.text) {
                apiMessages.push({ role, content: msg.text });
            }
        }
    });

    // Add current message
    apiMessages.push({ role: 'user', content: message });

    // 2. Call Local Llama
    const modelName = genSettings.localModelName || "llama3.1";
    
    let responseText = await callOllama(apiMessages, modelName, genSettings.localLlmUrl, genSettings);
    responseText = responseText.trim();

    // 3. Image Bridge Logic (The Selfie Feature)
    // Check for !IMG: tag
    if (responseText.includes("!IMG:")) {
        const parts = responseText.split("!IMG:");
        const textPart = parts[0].trim();
        const visualDescription = parts[1].trim();
        
        // If the model replied with just the tag, or text + tag
        // We will generate the image based on the description
        
        let imageUrl: string | undefined;
        let finalDisplayPrompt = visualDescription;
        
        try {
            // Remove brackets if model added them, e.g. [visual description]
            const cleanPrompt = visualDescription.replace(/^\[|\]$/g, '');
            
            imageUrl = await generateWithGradio(cleanPrompt, gradioEndpoint, genSettings);
            
            return { 
                text: textPart || "Here is the photo.", 
                image: imageUrl,
                visualPrompt: cleanPrompt
            };
        } catch (imgError) {
             console.error("Image generation failed", imgError);
             return { 
                text: textPart + "\n\n(I tried to send a photo but the connection failed: " + visualDescription + ")",
                isError: false 
            };
        }
    }

    // 4. Normal Text Response
    return { text: responseText };

  } catch (error: any) {
    return { 
        text: "Connection to Eve failed.", 
        isError: true, 
        errorMessage: error.message || "Unknown error", 
        errorType: 'GENERAL' 
    };
  }
};

// Placeholder exports to maintain compatibility with App.tsx imports if they exist
export const startChatWithHistory = async () => {};
export const generateVisualSelfie = async () => {};
