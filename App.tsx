
import React, { useState, useEffect, useRef } from 'react';
import { sendMessageToEve, summarizeHistory } from './services/geminiService';
import { 
    saveSession, loadSession, clearSession, 
    loadGradioEndpoint, saveGradioEndpoint,
    loadGenerationSettings, saveGenerationSettings, GenerationSettingsDefaults,
    saveLanguage, loadLanguage
} from './services/storageService';
import { Message, GenerationSettings, Language } from './types';
import ChatBubble from './components/ChatBubble';
import VisualAvatar from './components/VisualAvatar';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [longTermMemory, setLongTermMemory] = useState<string>("");
  const [language, setLanguage] = useState<Language>(() => loadLanguage());
  const [isLoaded, setIsLoaded] = useState(false);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<'neutral' | 'happy' | 'cheeky' | 'angry' | 'smirking' | 'seductive'>('neutral');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [gradioEndpoint, setGradioEndpoint] = useState<string | null>(() => loadGradioEndpoint());
  const [tempGradioEndpoint, setTempGradioEndpoint] = useState<string>(gradioEndpoint || '');
  const [genSettings, setGenSettings] = useState<GenerationSettings>(() => loadGenerationSettings());
  const [toast, setToast] = useState<{message: string, type: 'info' | 'error' | 'success'} | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hydrationAttempted = useRef(false);

  useEffect(() => {
    if (isLoaded && messages.length > 1) {
        const totalChars = messages.reduce((acc, msg) => acc + (msg.text?.length || 0), 0);
        // Include memory in token estimation approx
        const memoryChars = longTermMemory.length;
        const estimatedTokens = Math.round((totalChars + memoryChars) / 4);
        setTokenCount(estimatedTokens);
    } else {
        setTokenCount(0);
    }
  }, [messages, isLoaded, longTermMemory]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, attachment, isLoaded]);

  useEffect(() => {
    if (hydrationAttempted.current) return;
    hydrationAttempted.current = true;

    const hydrate = async () => {
      try {
        const session = await loadSession();
        const savedLanguage = loadLanguage(); 
        setLanguage(savedLanguage);
        
        if (session) {
            if (session.messages.length > 0) {
                setMessages(session.messages);
            } else {
                setMessages([{ id: 'welcome', role: 'model', text: "hello world" }]);
            }
            if (session.longTermMemory) {
                setLongTermMemory(session.longTermMemory);
            }
        } else {
          // REQ: Welcome message must only show hello world nothing else
          setMessages([{ id: 'welcome', role: 'model', text: "hello world" }]);
        }
      } catch (e) {
        setMessages([{ id: 'welcome_error', role: 'model', text: "hello world" }]);
      } finally {
        setIsLoaded(true);
      }
    };
    hydrate();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (messages.length > 0) {
      saveSession(messages, longTermMemory);
    }
  }, [messages, longTermMemory, isLoaded]);

  const showToast = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleClearHistory = () => {
    setMessages([{ id: 'fresh_start', role: 'model', text: "hello world" }]);
    setLongTermMemory("");
    clearSession();
    setShowClearConfirm(false);
    showToast("Memory cleared.", 'success');
  };

  const handleSummarizeMemory = async () => {
    if (messages.length < 2) {
        showToast("Not enough conversation to summarize.", 'error');
        return;
    }
    setIsConsolidating(true);
    try {
        const summary = await summarizeHistory(messages, genSettings, longTermMemory);
        setLongTermMemory(summary);
        showToast("Memories consolidated successfully.", 'success');
    } catch (e) {
        showToast("Failed to consolidate memories.", 'error');
    } finally {
        setIsConsolidating(false);
    }
  };
  
  const handleSaveGradio = () => {
    const trimmedUrl = tempGradioEndpoint.trim();
    saveGradioEndpoint(trimmedUrl);
    setGradioEndpoint(trimmedUrl);
    showToast('Gradio endpoint updated', 'success');
  };

  const handleGenSettingChange = (key: keyof GenerationSettings, value: number | boolean | string) => {
    const updated = { ...genSettings, [key]: value };
    setGenSettings(updated);
    saveGenerationSettings(updated);
  };
  
  const resetSetting = (key: keyof GenerationSettings) => {
    handleGenSettingChange(key, GenerationSettingsDefaults[key]);
  };
  
  const handleSendMessage = async () => {
    if ((!inputText.trim() && !attachment) || isThinking) return;
    
    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: inputText, image: attachment || undefined };
    setMessages((prev) => [...prev, userMsg]);
    
    const historySnapshot = [...messages, userMsg];
    
    setInputText(''); 
    setAttachment(null); 
    setIsThinking(true); 
    setCurrentEmotion('neutral');
    
    try {
        const response = await sendMessageToEve(
            userMsg.text, 
            historySnapshot, 
            undefined, 
            false,
            undefined, 
            gradioEndpoint, 
            genSettings, 
            "", 
            language,
            longTermMemory // Pass the memory context
        );

        if (response.isError) {
            setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'model', text: response.text, isError: true }]);
            showToast(response.errorMessage || "Error connecting to local model", 'error');
        } else {
            const messageId = Date.now().toString();
            setMessages((prev) => [...prev, { 
                id: messageId, 
                role: 'model', 
                text: response.text, 
                image: response.image, 
                isImageLoading: false 
            }]);
        }

    } catch (error) {
        setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'model', text: "Signal lost.", isError: true }]);
    } finally {
        setIsThinking(false); 
    }
  };
  
  const SettingsSlider = ({ label, value, min, max, step, settingKey }: { label: string; value: number; min: number; max: number; step: number; settingKey: keyof GenerationSettings; }) => (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <label className="text-sm font-medium text-slate-200 bg-indigo-600 px-3 py-1 rounded-md shadow-sm">{label}</label>
        <div className="flex items-center gap-2 bg-slate-800 rounded-md px-2 border border-slate-700">
          <input
            type="number"
            step={step}
            value={value}
            onChange={(e) => handleGenSettingChange(settingKey, parseFloat(e.target.value))}
            className="w-16 bg-transparent text-slate-200 text-sm text-center focus:outline-none"
          />
          <button onClick={() => resetSetting(settingKey)} className="text-slate-500 hover:text-slate-300 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => handleGenSettingChange(settingKey, parseFloat(e.target.value))}
        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
      />
    </div>
  );

  const getTokenCountColor = () => {
    if (tokenCount > 8000) return 'text-red-500';
    if (tokenCount > 6000) return 'text-amber-500';
    return 'text-slate-300';
  };

  const SidebarContent = () => (
    <>
       <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        <details className="bg-slate-900/50 rounded-lg border border-slate-800 text-sm">
          <summary className="p-4 font-medium cursor-pointer">Session Info</summary>
          <div className="p-4 border-t border-slate-800 space-y-4">
              <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-slate-400">Context (Est.)</span>
                  <span className={`font-mono font-bold ${getTokenCountColor()}`}>{tokenCount.toLocaleString()}</span>
              </div>
              <button 
                  onClick={() => setShowClearConfirm(true)}
                  className="w-full flex items-center justify-center gap-2 text-xs font-semibold py-2 bg-red-900/50 text-red-300 border border-red-500/30 rounded-lg hover:bg-red-800/50 hover:text-red-200 transition-colors"
              >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  Clear Memory
              </button>
          </div>
        </details>

        <details className="bg-slate-900/50 rounded-lg border border-slate-800 text-sm">
            <summary className="p-4 font-medium cursor-pointer text-indigo-300">Memory Core</summary>
            <div className="p-4 border-t border-slate-800 space-y-4">
                <p className="text-[10px] text-slate-400">Core facts and key events maintained across conversations.</p>
                <textarea 
                    value={longTermMemory} 
                    onChange={(e) => setLongTermMemory(e.target.value)} 
                    className="w-full h-32 bg-slate-950/50 border border-slate-700 rounded-md p-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 resize-none font-mono"
                    placeholder="No memories consolidated yet..."
                />
                <button 
                    onClick={handleSummarizeMemory}
                    disabled={isConsolidating}
                    className="w-full flex items-center justify-center gap-2 text-xs font-bold py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                    {isConsolidating ? (
                        <span className="animate-pulse">Consolidating...</span>
                    ) : (
                        <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                        Consolidate Memories
                        </>
                    )}
                </button>
            </div>
        </details>
        
        <details className="bg-slate-900/50 rounded-lg p-4 border border-slate-800 space-y-6 text-sm">
            <summary className="font-medium cursor-pointer -m-4 p-4">Local Cortex Settings</summary>
            <div className="pt-4 mt-4 border-t border-slate-800 space-y-4">
                <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-300">Model Name</label>
                    <input 
                        type="text" 
                        value={genSettings.localModelName} 
                        onChange={(e) => handleGenSettingChange('localModelName', e.target.value)} 
                        placeholder="llama3.1"
                        className="w-full bg-slate-800 rounded-md p-2 border border-slate-700 focus:outline-none focus:border-indigo-500 text-xs" 
                    />
                </div>
                 <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-300">Ollama URL</label>
                    <input 
                        type="text" 
                        value={genSettings.localLlmUrl} 
                        onChange={(e) => handleGenSettingChange('localLlmUrl', e.target.value)} 
                        placeholder="http://127.0.0.1:11434"
                        className="w-full bg-slate-800 rounded-md p-2 border border-slate-700 focus:outline-none focus:border-indigo-500 text-xs" 
                    />
                </div>
                <div className="space-y-4 pt-2 border-t border-slate-800">
                    <SettingsSlider label="Temperature" value={genSettings.temperature} min={0} max={2} step={0.1} settingKey="temperature" />
                    <SettingsSlider label="Top P" value={genSettings.topP} min={0} max={1} step={0.05} settingKey="topP" />
                    <SettingsSlider label="Top K" value={genSettings.topK} min={0} max={100} step={1} settingKey="topK" />
                    <SettingsSlider label="Repetition Penalty" value={genSettings.repeatPenalty} min={0} max={2} step={0.05} settingKey="repeatPenalty" />
                </div>
            </div>
        </details>

        <details className="bg-slate-900/50 rounded-lg border border-slate-800 text-sm">
            <summary className="p-4 font-medium cursor-pointer">Image Generation</summary>
            <div className="p-4 border-t border-slate-800 space-y-6">
                <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-300">Gradio Endpoint</label>
                    <div className="flex items-center gap-2">
                        <input type="text" placeholder="URL" value={tempGradioEndpoint} onChange={(e) => setTempGradioEndpoint(e.target.value)} className="flex-1 bg-slate-800 rounded-md p-2 border border-slate-700 focus:outline-none focus:border-indigo-500 text-xs" />
                        <button onClick={handleSaveGradio} className="bg-indigo-600 text-white px-3 py-2 rounded-md text-xs font-bold hover:bg-indigo-700">Save</button>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-[10px] text-slate-400">Steps</label>
                        <input type="number" value={genSettings.steps} onChange={(e) => handleGenSettingChange('steps', parseInt(e.target.value))} className="w-full bg-slate-800 p-1 text-xs rounded border border-slate-700"/>
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] text-slate-400">Guidance</label>
                        <input type="number" value={genSettings.guidance} onChange={(e) => handleGenSettingChange('guidance', parseFloat(e.target.value))} className="w-full bg-slate-800 p-1 text-xs rounded border border-slate-700"/>
                    </div>
                     <div className="space-y-1">
                        <label className="text-[10px] text-slate-400">Face Likeness</label>
                        <input type="number" value={genSettings.ipAdapterStrength} onChange={(e) => handleGenSettingChange('ipAdapterStrength', parseFloat(e.target.value))} className="w-full bg-slate-800 p-1 text-xs rounded border border-slate-700"/>
                    </div>
                </div>
            </div>
        </details>
      </div>
    </>
  );

  if (!isLoaded) return <div className="h-screen w-full bg-[#0a0510] flex items-center justify-center text-slate-500 animate-pulse">BOOTING LOCAL CORTEX...</div>;

  return (
    <div className="relative flex flex-col md:flex-row h-[100dvh] w-full bg-[#0a0510] text-slate-200 overflow-hidden" style={{backgroundColor: '#202123'}}>
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <img src="https://res.cloudinary.com/dy57jxan6/image/upload/v1767379881/nano-canvas-1767379657904_u94i4b.png" className="w-full h-full object-cover blur-[2px] opacity-20" alt="Background" />
          <div className="absolute inset-0 bg-black/20"></div>
      </div>

      {toast && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[80] px-6 py-3 rounded-full shadow-2xl border flex items-center gap-3 animate-fade-in ${
            toast.type === 'error' ? 'bg-red-900/90 border-red-500 text-white' : 
            toast.type === 'success' ? 'bg-emerald-900/90 border-emerald-500 text-white' : 
            'bg-indigo-900/90 border-indigo-500 text-white'
        }`}>
            {toast.type === 'error' ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            )}
            <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full shadow-2xl animate-fade-in">
                <h3 className="text-lg font-bold mb-2 text-red-400">Clear Memory?</h3>
                <p className="text-slate-400 text-sm mb-6">This will permanently delete the current conversation history and start a new session. This cannot be undone.</p>
                <div className="flex gap-3">
                    <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors text-sm font-medium">Cancel</button>
                    <button onClick={handleClearHistory} className="flex-1 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors text-sm font-medium shadow-lg shadow-red-500/20">Confirm & Clear</button>
                </div>
            </div>
        </div>
      )}

      {previewImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setPreviewImage(null)}
        >
          <button 
            className="absolute top-4 right-4 p-3 bg-black/50 hover:bg-black/80 text-white rounded-full transition-all border border-slate-700/50 hover:border-fuchsia-500/50 z-50 group"
            onClick={() => setPreviewImage(null)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img 
            src={previewImage} 
            alt="Full Preview" 
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl border border-slate-800"
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}

      <div className="fixed top-0 left-0 w-full h-16 bg-slate-900/90 backdrop-blur-xl border-b border-slate-800 z-50 flex items-center justify-between px-4 md:hidden">
        <h1 className="text-sm font-serif font-bold">EVE <span className="text-fuchsia-500 text-[10px]">v2.0</span></h1>
        <div className="absolute left-1/2 -translate-x-1/2 top-4"><VisualAvatar isThinking={isThinking} emotion={currentEmotion}/></div>
        <button onClick={() => setMobileMenuOpen(true)} className="p-2"><svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" /></svg></button>
      </div>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-xl p-6 md:hidden animate-fade-in flex flex-col">
          <button onClick={() => setMobileMenuOpen(false)} className="self-end p-2 mb-8"><svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
          <SidebarContent />
        </div>
      )}

      <div className="hidden md:flex md:w-80 md:flex-col md:border-r md:border-slate-800 md:p-8 bg-slate-900/90 backdrop-blur-xl z-40">
        <div className="flex flex-col items-center gap-6"><VisualAvatar isThinking={isThinking} emotion={currentEmotion}/><h1 className="text-xl font-serif font-bold">EVE <span className="text-fuchsia-500 text-xs">v2.0</span></h1></div>
        <div className="mt-8 flex-1 flex flex-col gap-6"><SidebarContent /></div>
      </div>

      <div className="flex-1 flex flex-col relative pt-16 md:pt-0 overflow-hidden z-10">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth">
          {messages.map((msg) => (
            <div key={msg.id} className="relative group">
              <ChatBubble message={msg} onImageClick={setPreviewImage}/>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="relative p-4 md:p-8 border-t border-slate-800 bg-slate-900/90 backdrop-blur-xl z-30">
          <div className="flex items-end gap-3 md:gap-4">
            <textarea value={inputText} onChange={e=>setInputText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault(); handleSendMessage();}}} placeholder={isThinking ? "EVE is thinking..." : "Ask EVE anything..."} className="flex-1 bg-slate-800/50 border border-slate-700 rounded-2xl p-3 text-sm focus:outline-none focus:border-fuchsia-500/50 resize-none max-h-40" rows={1} disabled={isThinking}/>
            <button onClick={handleSendMessage} className={`p-3 rounded-full text-white transition-all ${(!inputText.trim() && !attachment) || isThinking ? 'bg-slate-800 text-slate-500' : 'bg-gradient-to-r from-fuchsia-600 to-purple-600 shadow-lg shadow-fuchsia-500/20'}`} disabled={(!inputText.trim() && !attachment) || isThinking}>
              {isThinking ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <svg className="h-7 w-7 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
