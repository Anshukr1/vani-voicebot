import React, { useState, useRef, useEffect } from 'react';
import { AppState, ChatMessage, NewsSource, UserProfile } from './types';
import { LiveNewsSession } from './services/geminiService';
import { decodeAudioData, float32ToBase64PCM } from './services/audioUtils';
import Visualizer from './components/Visualizer';
import NewsCard from './components/NewsCard';

const App: React.FC = () => {
  // UI State
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [formData, setFormData] = useState<UserProfile>({ profession: '', city: '', investments: '', interests: '' });
  const [appState, setAppState] = useState<AppState>(AppState.DISCONNECTED);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [volume, setVolume] = useState<number>(0); // For visualizer
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);

  // Audio Context Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const liveSessionRef = useRef<LiveNewsSession | null>(null);
  
  useEffect(() => {
    // Initialize Live Session Wrapper
    liveSessionRef.current = new LiveNewsSession();
    
    return () => {
      stopSession();
    };
  }, []);

  // Scroll to bottom
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const appendToChatHistory = (role: 'user' | 'assistant', text: string, sources?: NewsSource[]) => {
      setChatHistory(prev => {
          const history = [...prev];
          const lastMsg = history[history.length - 1];

          if (lastMsg && lastMsg.role === role) {
              lastMsg.text += text;
              if (sources && sources.length > 0) {
                  const existingUris = new Set(lastMsg.sources?.map(s => s.uri) || []);
                  const newSources = sources.filter(s => !existingUris.has(s.uri));
                  lastMsg.sources = [...(lastMsg.sources || []), ...newSources];
              }
              return [...history]; 
          } 
          
          return [...history, {
              role,
              text,
              isFinal: false,
              timestamp: Date.now(),
              sources: sources || []
          }];
      });
  };

  const startSession = async () => {
    setErrorMsg(null);
    setChatHistory([]);
    setIsMicMuted(false);
    nextStartTimeRef.current = 0;
    
    setAppState(AppState.CONNECTING);

    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      // Ensure context is running (browsers may suspend it)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      inputStreamRef.current = stream;

      await liveSessionRef.current?.connect(
        userProfile!,
        // onOpen
        () => {
          setAppState(AppState.CONNECTED);
          setupAudioInput(stream);
        },
        // onMessage
        async (message) => {
          const parts = message.serverContent?.modelTurn?.parts;
          let partText = '';
          if (parts) {
            for (const part of parts) {
              if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) {
                if (audioContextRef.current) {
                  playAudioChunk(part.inlineData.data);
                }
              }
              if (part.text) {
                partText += part.text;
              }
            }
          }

          let currentSources: NewsSource[] = [];
          const groundingMetadata = message.serverContent?.groundingMetadata;
          if (groundingMetadata?.groundingChunks) {
              groundingMetadata.groundingChunks.forEach((chunk: any) => {
                  if (chunk.web?.uri && chunk.web?.title) {
                      currentSources.push({
                          title: chunk.web.title,
                          uri: chunk.web.uri
                      });
                  }
              });
          }

          if (message.serverContent?.outputTranscription) {
             const text = message.serverContent.outputTranscription.text;
             if (text) appendToChatHistory('assistant', text, currentSources);
          } else if (partText) {
             appendToChatHistory('assistant', partText, currentSources);
          } else if (currentSources.length > 0) {
             appendToChatHistory('assistant', '', currentSources);
          }

          if (message.serverContent?.inputTranscription) {
             const text = message.serverContent.inputTranscription.text;
             if (text) appendToChatHistory('user', text);
          }

          if (message.serverContent?.interrupted) {
            handleInterruption();
          }
        },
        // onClose
        () => {
          stopSession();
        },
        // onError
        (err) => {
          console.error("Live API Error:", err);
          setErrorMsg("Session error. Please check your network or try again.");
          stopSession();
        }
      );

    } catch (err) {
      console.error("Setup Error:", err);
      setErrorMsg("Could not connect to the service. Please try again.");
      setAppState(AppState.DISCONNECTED);
    }
  };

  const setupAudioInput = (stream: MediaStream) => {
    if (!audioContextRef.current || !liveSessionRef.current) return;
    
    const source = audioContextRef.current.createMediaStreamSource(stream);
    const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
    
    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
      const rms = Math.sqrt(sum / inputData.length);
      setVolume(Math.min(rms * 5, 1)); 

      const base64PCM = float32ToBase64PCM(inputData);
      liveSessionRef.current?.sendAudioChunk(base64PCM);
    };

    const gainNode = audioContextRef.current.createGain();
    gainNode.gain.value = 0;
    gainNodeRef.current = gainNode;

    source.connect(processor);
    processor.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);
    processorRef.current = processor;
  };

  const playAudioChunk = async (base64Audio: string) => {
    if (!audioContextRef.current) return;

    try {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const bytes = atob(base64Audio);
      const array = new Uint8Array(bytes.length);
      for(let i=0; i<bytes.length; i++) array[i] = bytes.charCodeAt(i);

      const audioBuffer = await decodeAudioData(array, audioContextRef.current);
      
      const currentTime = audioContextRef.current.currentTime;
      if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime;
      }
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.start(nextStartTimeRef.current);
      
      audioSourcesRef.current.add(source);
      source.onended = () => audioSourcesRef.current.delete(source);
      
      nextStartTimeRef.current += audioBuffer.duration;
      setVolume(0.5); 
      
    } catch (e) {
      console.error("Audio Decode Error", e);
    }
  };

  const handleInterruption = () => {
    console.log("Bot interrupted!");
    audioSourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    audioSourcesRef.current.clear();
    
    if (audioContextRef.current) {
        nextStartTimeRef.current = audioContextRef.current.currentTime;
    }
  };

  const stopSession = () => {
    liveSessionRef.current?.close();

    if (inputStreamRef.current) {
        inputStreamRef.current.getTracks().forEach(t => t.stop());
        inputStreamRef.current = null;
    }

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
      } catch (e) { /* ignore */ }
      processorRef.current = null;
    }

    if (gainNodeRef.current) {
      try {
        gainNodeRef.current.disconnect();
      } catch (e) { /* ignore */ }
      gainNodeRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try { audioContextRef.current.close(); } catch(e) {}
    }
    audioContextRef.current = null;
    
    setAppState(AppState.DISCONNECTED);
    setVolume(0);
    setIsMicMuted(false);
  };

  const toggleMic = () => {
    if (inputStreamRef.current) {
      const audioTracks = inputStreamRef.current.getAudioTracks();
      const newMutedState = !isMicMuted;
      audioTracks.forEach(track => {
        track.enabled = !newMutedState;
      });
      setIsMicMuted(newMutedState);
    }
  };

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-slate-800 p-8 rounded-3xl shadow-2xl border border-slate-700">
          <div className="flex items-center space-x-3 mb-8 justify-center">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-rose-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Vani Live</h1>
          </div>
          
          <h2 className="text-xl font-medium mb-6 text-center text-slate-300">Set Up Your Profile</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Profession</label>
              <input 
                type="text" 
                value={formData.profession}
                onChange={e => setFormData({...formData, profession: e.target.value})}
                placeholder="e.g. Software Engineer, Teacher"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">City</label>
              <input 
                type="text" 
                value={formData.city}
                onChange={e => setFormData({...formData, city: e.target.value})}
                placeholder="e.g. Mumbai, Delhi"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Investments</label>
              <input 
                type="text" 
                value={formData.investments}
                onChange={e => setFormData({...formData, investments: e.target.value})}
                placeholder="e.g. Mutual Funds, Stocks, None"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Top 2 Interests</label>
              <input 
                type="text" 
                value={formData.interests}
                onChange={e => setFormData({...formData, interests: e.target.value})}
                placeholder="e.g. Technology, Cricket"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
            
            <button 
              onClick={() => {
                if (formData.profession && formData.city && formData.investments && formData.interests) {
                  setUserProfile(formData);
                } else {
                  alert("Please fill in all fields to continue.");
                }
              }}
              className="w-full mt-6 bg-gradient-to-r from-indigo-600 to-rose-600 hover:from-indigo-500 hover:to-rose-500 text-white font-bold py-4 px-6 rounded-xl shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Save & Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center relative overflow-hidden font-sans">
      
      {/* Background Ambience */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className={`absolute -top-[20%] -right-[20%] w-[600px] h-[600px] bg-indigo-900/20 rounded-full blur-[100px] transition-opacity duration-1000 ${appState === AppState.CONNECTED ? 'opacity-100' : 'opacity-50'}`} />
        <div className={`absolute top-[40%] -left-[20%] w-[500px] h-[500px] bg-rose-900/20 rounded-full blur-[100px] transition-opacity duration-1000 ${appState === AppState.CONNECTED ? 'opacity-100' : 'opacity-50'}`} />
      </div>

      <div className="relative z-10 w-full max-w-2xl px-4 py-6 flex flex-col h-screen">
        
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
             <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-rose-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
               <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
               </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Vani Live</h1>
              <p className="text-xs text-slate-400">Gemini Native Audio</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <span className={`w-2 h-2 rounded-full transition-colors duration-300 ${appState === AppState.CONNECTED ? 'bg-red-500 animate-pulse' : appState === AppState.CONNECTING ? 'bg-yellow-500 animate-pulse' : 'bg-slate-600'}`} />
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                {appState === AppState.CONNECTED ? 'LIVE' : appState === AppState.CONNECTING ? 'CONNECTING' : 'OFF AIR'}
            </span>
          </div>
        </header>

        {/* Transcript Area */}
        <div className="flex-1 overflow-y-auto scrollbar-hide -mx-4 px-4 pb-4 space-y-4">
            {chatHistory.length === 0 && appState === AppState.DISCONNECTED && (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-50 space-y-4">
                     <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                     </div>
                    <div>
                        <p className="text-lg font-medium text-slate-300">Ready to Go Live?</p>
                        <p className="text-sm text-slate-500 mt-1">Tap "Start" to begin your personalized news broadcast.</p>
                    </div>
                </div>
            )}
            
             {chatHistory.length === 0 && appState === AppState.CONNECTING && (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                     <div className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                    <div>
                        <p className="text-lg font-medium text-indigo-400">Connecting...</p>
                        <p className="text-sm text-slate-500 mt-1">Establishing secure connection to Vani.</p>
                    </div>
                </div>
            )}

            {chatHistory.map((msg, idx) => (
                <NewsCard key={idx} message={msg} />
            ))}
            <div ref={chatEndRef} />
        </div>

        {/* Error Notification */}
        {errorMsg && (
            <div className="mb-4 bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {errorMsg}
            </div>
        )}

        {/* Footer Controls */}
        <div className="mt-auto bg-slate-900/80 backdrop-blur-xl border-t border-slate-800 pt-6 pb-4 -mx-4 px-6 rounded-t-3xl shadow-2xl">
            
            <div className="h-16 mb-6 relative w-full bg-slate-950 rounded-xl overflow-hidden border border-slate-800/50">
                 <Visualizer isActive={appState === AppState.CONNECTED} mode={volume > 0.1 ? 'speaking' : 'listening'} />
            </div>

            <div className="flex justify-center">
                {appState === AppState.DISCONNECTED ? (
                    <button
                        onClick={startSession}
                        className="group relative flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-indigo-600 to-rose-600 hover:from-indigo-500 hover:to-rose-500 text-white rounded-full font-bold text-lg shadow-lg shadow-indigo-900/30 transition-all hover:scale-105 active:scale-95 w-full md:w-auto"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                        Start Live Broadcast
                    </button>
                ) : (
                    <div className="flex items-center gap-4">
                        <button
                            onClick={stopSession}
                            className="flex items-center justify-center gap-3 px-8 py-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-full font-bold text-lg transition-all w-full md:w-auto"
                        >
                            <div className="w-3 h-3 bg-red-500 rounded-sm animate-pulse" />
                            End Broadcast
                        </button>
                        <button
                            onClick={toggleMic}
                            className={`flex items-center justify-center w-14 h-14 rounded-full transition-all border ${isMicMuted ? 'bg-red-500/20 border-red-500/50 text-red-500 hover:bg-red-500/30' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
                            title={isMicMuted ? "Unmute Mic" : "Mute Mic"}
                        >
                            {isMicMuted ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l16 16" />
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                </svg>
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;