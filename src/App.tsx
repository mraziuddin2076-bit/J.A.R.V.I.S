import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Activity, Cpu, Power, Zap, Hash, Settings, X } from 'lucide-react';

interface DiagnosticMetric {
  key: string;
  value: string;
}

interface JarvisResponse {
  status: string;
  power_output: string;
  query_result: string;
  action_url?: string;
  diagnostic_metrics: DiagnosticMetric[];
}

export default function App() {
  const [systemActive, setSystemActive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Settings State
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [speechSpeed, setSpeechSpeed] = useState(1.0);
  const [assistantName, setAssistantName] = useState("J.A.R.V.I.S.");
  
  // Voice & Transcript State
  const [transcript, setTranscript] = useState("AWAITING INPUT...");
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Response State
  const [jarvisData, setJarvisData] = useState<JarvisResponse | null>(null);

  // Audio & Visualizer Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestFrameRef = useRef<number>(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Speech Recognition Ref
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // 1. Initialize System (Arming)
  const armSystem = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setSystemActive(true);
      startVisualizer(stream);
      setupSpeechRecognition();
      speakFeedback("System online. Good to see you, Sir.");
    } catch (err) {
      console.warn("Microphone access denied or unavailable.");
      setSystemActive(true);
      setTranscript("MIC_ACCESS_DENIED // AWAITING_KEYBOARD_OVERRIDE");
      speakFeedback("System online. Acoustic sensors are impaired. Keyboard override is available.");
      setupDummyVisualizer();
    }
  };

  const setupDummyVisualizer = () => {
    const draw = () => {
      requestFrameRef.current = requestAnimationFrame(draw);
      if (!canvasRef.current) return;
      
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = (canvas.width / 2) - 30;

      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'red';

      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.font = '10px monospace';
      ctx.fillStyle = 'red';
      ctx.textAlign = 'center';
      ctx.fillText('NO AUDIO SIGNAL', centerX, centerY);
    };
    draw();
  };

  const startVisualizer = (stream: MediaStream) => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const audioCtx = new AudioContextClass();
    audioContextRef.current = audioCtx;
    const analyser = audioCtx.createAnalyser();
    analyserRef.current = analyser;
    analyser.fftSize = 128;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      requestFrameRef.current = requestAnimationFrame(draw);
      if (!canvasRef.current) return;
      
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      analyser.getByteFrequencyData(dataArray);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = (canvas.width / 2) - 30;

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00f0ff';
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#00f0ff';

      const step = (Math.PI * 2) / bufferLength;

      for (let i = 0; i < bufferLength; i++) {
        const value = dataArray[i];
        const percent = value / 255;
        const amplitude = percent * 40; // visualizer spike max height

        const angle = i * step;
        const x1 = centerX + Math.cos(angle) * baseRadius;
        const y1 = centerY + Math.sin(angle) * baseRadius;
        const x2 = centerX + Math.cos(angle) * (baseRadius + amplitude);
        const y2 = centerY + Math.sin(angle) * (baseRadius + amplitude);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    };
    draw();
  };

  // 2. Speech Recognition Setup
  const setupSpeechRecognition = () => {
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setTranscript("SPEECH RECOGNITION NOT SUPPORTED IN BROWSER");
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event) => {
      let currentTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const finalStr = event.results[i][0].transcript.trim();
          setTranscript(finalStr);
          processQuery(finalStr);
        } else {
          currentTranscript += event.results[i][0].transcript;
          setTranscript(currentTranscript);
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted') {
        // 'aborted' is expected when stopping manually or when the browser interrupts it briefly.
        return;
      }
      console.warn("Speech recognition error:", event.error);
    };

    recognition.onend = () => {
      // Auto-restart listening if active, but delay slightly
      if (systemActiveRef.current) {
         setTimeout(() => {
           try { recognition.start(); } catch(e) {}
         }, 1000);
      } else {
         setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    
    // Slight delay to ensure previous mic tasks are cleared
    setTimeout(() => {
      try { recognitionRef.current?.start(); } catch (e) { console.warn(e); }
    }, 1000);
  };

  // Hack for inside closures
  const systemActiveRef = useRef(systemActive);
  useEffect(() => {
    systemActiveRef.current = systemActive;
  }, [systemActive]);

  const voiceEnabledRef = useRef(voiceEnabled);
  const speechSpeedRef = useRef(speechSpeed);
  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    speechSpeedRef.current = speechSpeed;
  }, [voiceEnabled, speechSpeed]);

  // Cleanup
  useEffect(() => {
    return () => {
      cancelAnimationFrame(requestFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // 3. Voice Synthesis
  const speakFeedback = (text: string) => {
    if (!voiceEnabledRef.current) return;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = speechSpeedRef.current;
      utterance.pitch = 0.9;
      
      // Try to find a British male voice
      const voices = window.speechSynthesis.getVoices();
      const ukVoice = voices.find(v => v.lang === 'en-GB' && v.name.includes("Male")) 
                   || voices.find(v => v.lang === 'en-GB');
      
      if (ukVoice) {
        utterance.voice = ukVoice;
      }
      
      window.speechSynthesis.speak(utterance);
    }
  };

  const shutdownSystem = () => {
    setSystemActive(false);
    setTranscript("AWAITING INPUT...");
    setIsListening(false);
    setJarvisData(null);
    speakFeedback("Powering down, Sir.");
    
    // Cleanup active processors
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
    }
    cancelAnimationFrame(requestFrameRef.current);
    
    // Stop any active streams
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
  };

  // 4. Query Processing
  const processQuery = async (query: string) => {
    if (!query || isProcessing) return;
    
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes("shut down") || lowerQuery.includes("shutdown") || lowerQuery.includes("power down") || lowerQuery === "exit") {
      shutdownSystem();
      return;
    }
    
    setIsProcessing(true);
    
    try {
      if (!navigator.onLine) {
        throw new Error("OFFLINE");
      }

      const res = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: query })
      });
      
      if (!res.ok) throw new Error("Server error");
      
      const data: JarvisResponse = await res.json();
      
      if (data.status === "ERR_UPLINK_SEVERED" || data.status === "ERR_API_QUOTA") {
         throw new Error("API_UPLINK_SEVERED");
      }
      
      setJarvisData(data);
      speakFeedback(data.query_result);
      
      if (data.action_url) {
        // We add a slight delay to allow JARVIS to speak first
        setTimeout(() => {
          window.open(data.action_url, '_blank', 'noopener,noreferrer');
        }, 1500);
      }
    } catch (err: any) {
      console.warn("Failed to process query", err);
      
      const isOffline = !navigator.onLine || err.message === "OFFLINE" || err.message === "API_UPLINK_SEVERED" || err.message.includes("Failed to fetch");
      
      if (isOffline) {
        const q = query.toLowerCase();
        let fallbackResult = "Sir, I am operating offline. External uplinks are down, but core systems remain active.";
        
        if (q.includes("time")) {
          fallbackResult = `The current time is ${new Date().toLocaleTimeString('en-US')}.`;
        } else if (q.includes("hello") || q.includes("hi") || q.includes("hey") || q.includes("jarvis")) {
          fallbackResult = "Good day, Sir. I am functioning on local power and cache.";
        } else if (q.includes("status") || q.includes("how are you")) {
          fallbackResult = "Local systems are stable, Sir. Network connectivity is currently compromised.";
        } else if (q.includes("open") || q.includes("website") || q.includes("go to")) {
          fallbackResult = "I'm afraid I cannot navigate the web without an active connection, Sir.";
        } else if (q.includes("weather") || q.includes("temperature")) {
          fallbackResult = "External sensors are disconnected. I cannot retrieve local weather data.";
        } else if (err.message === "API_UPLINK_SEVERED") {
          fallbackResult = "Sir, we have lost API connectivity due to quota or external server downtime. Switching to local backup mode.";
        }

        const fallbackData: JarvisResponse = {
          status: "LOCAL_CACHE",
          power_output: "12% (BATTERY)",
          query_result: fallbackResult,
          diagnostic_metrics: [
            { key: "UPLINK", value: "OFFLINE" },
            { key: "MODE", value: "LOCAL_FALLBACK" }
          ]
        };
        
        setJarvisData(fallbackData);
        speakFeedback(fallbackResult);
      } else {
        speakFeedback("I'm sorry Sir, I am unable to connect to the main servers at this time.");
        setJarvisData({
          status: "ERR_FAULT",
          power_output: "0%",
          query_result: "System encountered an anomaly during processing.",
          diagnostic_metrics: [
            { key: "ERR_CODE", value: "500_LOCAL_FAULT" },
            { key: "UPLINK", value: "UNSTABLE" }
          ]
        });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full h-screen jarvis-grid flex flex-col items-center justify-center font-mono relative overflow-hidden select-none">
      <div className="scanline"></div>

      {/* Futuristic Corner Brackets */}
      <div className="tech-bracket bracket-tl m-[3%] animate-pulse"></div>
      <div className="tech-bracket bracket-tr m-[3%] animate-pulse"></div>
      <div className="tech-bracket bracket-bl m-[3%] animate-pulse"></div>
      <div className="tech-bracket bracket-br m-[3%] animate-pulse"></div>
      
      {/* Decorative Target Reticles corners */}
      <div className="absolute top-[5%] left-[5%] w-8 h-8 border border-cyan-500/30 rounded-full opacity-60 flex items-center justify-center">
        <div className="w-1 h-1 bg-cyan-400 rounded-full"></div>
      </div>
      <div className="absolute bottom-[5%] right-[5%] w-8 h-8 border border-cyan-500/30 rounded-full opacity-60 flex items-center justify-center">
        <div className="w-1 h-1 bg-cyan-400 rounded-full"></div>
      </div>

      {/* Floating HUD Indicators */}
      {systemActive && (
        <>
          <div className="absolute top-[20%] left-[3%] flex flex-col items-center gap-2 opacity-60 hover:opacity-100 transition-opacity z-20">
            <div className="w-[1px] h-32 bg-gradient-to-b from-transparent via-cyan-400 to-transparent"></div>
            <p className="text-[10px] tracking-[0.4em] rotate-90 my-16 bg-[#010308] px-2 glow-text font-display">ALT_Z_AXIS</p>
            <div className="w-[1px] h-32 bg-gradient-to-b from-transparent via-cyan-400 to-transparent"></div>
          </div>
          <div className="absolute top-[20%] right-[3%] flex flex-col items-center gap-2 opacity-60 hover:opacity-100 transition-opacity z-20">
            <div className="w-8 h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>
            <p className="text-[10px] tracking-[0.4em] rotate-[270deg] my-16 bg-[#010308] px-2 text-cyan-200 glow-text font-display">LAT_OVERRIDE</p>
            <div className="w-8 h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>
          </div>
          <button 
            onClick={() => setShowSettings(true)}
            className="absolute top-8 right-8 lg:right-16 z-50 text-cyan-400 hover:text-cyan-100 hover:glow-text transition-all p-3 bg-cyan-950/40 border border-cyan-500/50 rounded-full backdrop-blur-xl shadow-[0_0_20px_rgba(0,240,255,0.2)]"
            title="System Settings"
          >
            <Settings className="w-6 h-6 animate-[spin_8s_linear_infinite]" />
          </button>
        </>
      )}

      {/* Settings Panel Overlay */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="tech-panel bg-cyan-950/90 p-8 w-full max-w-md border border-cyan-400 shadow-[0_0_30px_rgba(0,240,255,0.2)] relative"
            >
              <div className="flex justify-between items-center mb-8 border-b border-cyan-500/50 pb-4">
                <h3 className="text-cyan-400 uppercase tracking-[0.3em] font-bold flex items-center gap-3">
                  <Cpu className="w-5 h-5" /> Config Matrix
                </h3>
                <button onClick={() => setShowSettings(false)} className="text-cyan-500 hover:text-cyan-100 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="bg-cyan-900/20 p-4 border-l-2 border-cyan-500">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-cyan-100 text-xs uppercase tracking-widest font-semibold flex items-center gap-2">
                      <Zap className="w-3 h-3 text-yellow-400" /> Acoustic Output
                    </label>
                    <button 
                      onClick={() => setVoiceEnabled(!voiceEnabled)}
                      className={`w-12 h-6 rounded-full border border-cyan-400 p-1 transition-colors ${voiceEnabled ? 'bg-cyan-600/50 shadow-[0_0_10px_#00f0ff]' : 'bg-transparent'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-cyan-100 transition-transform ${voiceEnabled ? 'translate-x-6 bg-cyan-300' : 'bg-cyan-600'}`}></div>
                    </button>
                  </div>
                  <p className="text-cyan-400/60 text-[10px] tracking-wide">Enable or disable system voice synthesis.</p>
                </div>

                <div className="bg-cyan-900/20 p-4 border-l-2 border-cyan-500">
                  <label className="text-cyan-100 text-xs uppercase tracking-widest font-semibold block mb-2 opacity-90 flex items-center gap-2">
                    <Activity className="w-3 h-3 text-cyan-400" /> Vocal Cadence Ratio
                  </label>
                  <select 
                    value={speechSpeed}
                    onChange={(e) => setSpeechSpeed(Number(e.target.value))}
                    className="w-full bg-[#050a15] border border-cyan-500/50 text-cyan-100 p-2 text-xs outline-none focus:border-cyan-300 tracking-widest font-mono"
                  >
                    <option value={0.7}>0.7x | SLOW_TRACK</option>
                    <option value={1.0}>1.0x | OPTIMAL_TRACK</option>
                    <option value={1.3}>1.3x | ACCEL_TRACK</option>
                  </select>
                </div>

                <div className="bg-cyan-900/20 p-4 border-l-2 border-cyan-500">
                  <label className="text-cyan-100 text-xs uppercase tracking-widest font-semibold block mb-2 opacity-90">Protocol Designation</label>
                  <input 
                    type="text" 
                    value={assistantName}
                    onChange={(e) => setAssistantName(e.target.value)}
                    className="w-full bg-[#050a15] border border-cyan-500/50 text-cyan-100 p-2 text-xs outline-none focus:border-cyan-300 uppercase tracking-widest font-bold"
                  />
                </div>

                <div className="mt-8 flex items-center justify-between text-[10px] text-cyan-400/50 uppercase tracking-[0.2em]">
                  <p className="flex items-center gap-1"><Hash className="w-3 h-3"/> SYS. VERSION_2.0.1</p>
                  <p className="text-cyan-400/80">CORE_ACTIVE</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {!systemActive ? (
          <motion.div
            key="initiate"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1, filter: "blur(10px)" }}
            className="flex flex-col items-center z-10"
          >
            <div className="relative mb-8">
               <h1 className="text-6xl md:text-8xl flex text-shadow-[0_0_30px_#00f0ff] font-display text-cyan-50 tracking-[0.3em] font-bold z-10 relative">
                 {assistantName}
               </h1>
               <h1 className="text-6xl md:text-8xl absolute top-1 left-2 text-cyan-500/30 tracking-[0.3em] font-bold z-0 font-display blur-[2px]">{assistantName}</h1>
            </div>
            
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-lg blur opacity-25 group-hover:opacity-60 transition duration-1000 group-hover:duration-200"></div>
              <button
                onClick={armSystem}
                className="relative tech-panel bg-cyan-950/80 px-12 py-5 text-cyan-400 uppercase tracking-[0.2em] hover:bg-cyan-900/90 transition-all duration-300"
              >
                <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-cyan-300"></div>
                <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-cyan-300"></div>
                <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-cyan-300"></div>
                <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-cyan-300"></div>
                <span className="relative z-10 flex items-center gap-4 font-semibold group-hover:glow-text text-sm md:text-base">
                  <Power className="w-6 h-6 text-cyan-300" />
                  Initialize Uplink
                </span>
              </button>
            </div>
            <p className="mt-10 text-cyan-400/50 text-[10px] tracking-[0.4em] uppercase flex items-center gap-3 font-display">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full shadow-[0_0_10px_red] animate-pulse"></span>
              Awaiting Biometric Authorization
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full max-w-7xl h-full flex flex-col py-8 px-6 lg:px-12 z-10 relative"
          >
            {/* Ambient Background Glow for Active State */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-cyan-900/10 rounded-full blur-[100px] pointer-events-none -z-10"></div>
            
            {/* Header Status */}
            <header className="flex justify-between items-start text-[10px] uppercase tracking-[0.2em] text-cyan-400/60 mb-8 border-b border-cyan-500/30 pb-4 relative font-display">
              <div className="absolute bottom-0 left-0 w-32 h-[2px] bg-cyan-400 shadow-[0_0_10px_#00f0ff]"></div>
              <div>
                <p className="text-cyan-300 tracking-[0.3em] font-semibold text-xs">MARK LXXXV OS <span className="opacity-40">|| {new Date().toLocaleTimeString('en-US', { hour12: false })}</span></p>
                <div className="flex items-center gap-2 mt-2">
                   <div className="w-2.5 h-2.5 bg-cyan-400 rounded-sm shadow-[0_0_12px_#00f0ff]"></div>
                   <p className="text-cyan-50 glow-text font-bold text-[11px] tracking-widest">SECURE UPLINK ESTABLISHED</p>
                </div>
              </div>
              <div className="flex gap-8 lg:gap-16">
                <div className="text-right">
                  <p className="opacity-70">SYS. PROTOCOL</p>
                  <p className={`mt-1 font-bold text-xs tracking-widest ${isListening ? 'text-green-400 drop-shadow-[0_0_5px_#4ade80]' : 'text-cyan-300'}`}>{isListening ? 'LISTENING' : 'IDLE'}</p>
                </div>
                <div className="text-right">
                  <p className="opacity-70">PROCESS CORE</p>
                  <p className={`mt-1 font-bold text-xs tracking-widest ${isProcessing ? 'text-yellow-400 animate-pulse drop-shadow-[0_0_5px_#facc15]' : 'text-cyan-300'}`}>{isProcessing ? 'COMPUTING' : 'STANDBY'}</p>
                </div>
              </div>
            </header>

            <div className="flex-1 flex flex-col lg:flex-row gap-12 items-center justify-between mt-4">
              
              {/* Central Arc Reactor Widget */}
              <div className="relative w-80 h-80 md:w-96 md:h-96 shrink-0 mx-auto order-1 lg:order-2">
                <div className="radar-sweep"></div>
                {/* Outer spin rings */}
                <div className="absolute inset-0 border-[2px] border-dashed border-cyan-400/40 rounded-full animate-spin-slow"></div>
                <div className="absolute inset-[-10px] hud-ring-segmented animate-spin-slow-reverse opacity-60"></div>
                <div className="absolute inset-3 border-[1px] border-cyan-400/30 rounded-full animate-spin-slow-reverse" style={{clipPath: 'polygon(0 0, 100% 0, 100% 70%, 0 70%)'}}></div>
                <div className="absolute inset-5 border border-cyan-400/40 rounded-full border-l-cyan-300 animate-spin-fast shadow-[0_0_15px_rgba(0,240,255,0.4)]"></div>
                
                {/* Depth rings */}
                <div className="absolute inset-10 border-[6px] border-cyan-900/50 rounded-full"></div>
                
                {/* Canvas Visualizer */}
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full z-10" />

                {/* Core pulse */}
                <div className={`absolute inset-[4.5rem] rounded-full bg-cyan-950/80 border-[2px] border-cyan-300 flex items-center justify-center backdrop-blur-md ${isListening && !isProcessing ? 'glow-arc shadow-[0_0_40px_#00f0ff]' : ''}`}>
                  <div className="absolute inset-2 rounded-full border border-cyan-400/30 animate-pulse-ring"></div>
                  <div className="absolute inset-4 rounded-full border border-cyan-400/10 animate-spin-slow border-t-cyan-400"></div>
                  {isProcessing ? (
                    <Cpu className="w-14 h-14 text-cyan-50 animate-pulse drop-shadow-[0_0_10px_#fff]" />
                  ) : (
                    <Mic className="w-14 h-14 text-cyan-300 drop-shadow-[0_0_10px_#00f0ff]" />
                  )}
                </div>

                {/* Target Locks */}
                <div className="absolute -left-8 top-1/2 w-8 h-[2px] bg-cyan-400/70 shadow-[0_0_5px_#00f0ff]"></div>
                <div className="absolute -right-8 top-1/2 w-8 h-[2px] bg-cyan-400/70 shadow-[0_0_5px_#00f0ff]"></div>
                <div className="absolute top-[-2rem] left-1/2 w-[2px] h-8 bg-cyan-400/70 shadow-[0_0_5px_#00f0ff] -translate-x-1/2"></div>
                <div className="absolute bottom-[-2rem] left-1/2 w-[2px] h-8 bg-cyan-400/70 shadow-[0_0_5px_#00f0ff] -translate-x-1/2"></div>
                
                {/* Decorative angled corners inside arc area */}
                <div className="absolute top-[15%] left-[15%] w-3 h-3 border-t-2 border-l-2 border-cyan-400/80"></div>
                <div className="absolute bottom-[15%] right-[15%] w-3 h-3 border-b-2 border-r-2 border-cyan-400/80"></div>
              </div>

              {/* Data & Terminal View Left/Right */}
              <div className="flex-1 w-full flex flex-col justify-center space-y-6 order-2 lg:order-1 lg:pr-12">
                
                {/* Transcript Tech Panel */}
                <div className="tech-panel bg-cyan-600/10 p-6 lg:max-w-xl relative group">
                  <div className="absolute top-0 right-10 w-20 h-[3px] bg-cyan-400 shadow-[0_0_8px_#00f0ff]"></div>
                  <div className="absolute top-2 right-2 text-[8px] text-cyan-500/40 opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-widest">
                    KEYBOARD_OVERRIDE_ACTIVE
                  </div>
                  <input 
                    type="text"
                    className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-cyan-400 focus:outline-none z-20 cursor-text mix-blend-overlay"
                    title="Type to manually input command"
                    onKeyDown={(e) => {
                       if (e.key === 'Enter') {
                         const val = e.currentTarget.value.trim();
                         if (val) {
                           setTranscript(val);
                           processQuery(val);
                           e.currentTarget.value = '';
                         }
                       }
                    }}
                  />
                  <p className="text-cyan-400/60 uppercase tracking-[0.3em] font-display text-[11px] mb-3 flex items-center gap-2 border-b border-cyan-500/30 pb-2">
                    <Activity className="w-4 h-4 text-cyan-300" /> User.Directive.Audio/Text
                  </p>
                  <p className="text-xl md:text-2xl text-cyan-50 uppercase tracking-widest leading-relaxed min-h-[5rem] font-medium drop-shadow-[0_0_5px_rgba(0,240,255,0.5)]">
                    <span className="text-cyan-500/80 mr-3 animate-pulse">&gt;</span>
                    {isProcessing ? <span className="glitch-effect">{transcript}</span> : transcript}
                  </p>
                </div>

                {/* Settings & Diagnostic Panel */}
                <AnimatePresence>
                  {jarvisData && (
                    <motion.div
                      initial={{ opacity: 0, x: -30, scale: 0.95 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 200, damping: 25 }}
                      className="tech-panel bg-cyan-900/40 p-6 relative lg:max-w-xl shadow-[0_0_20px_rgba(0,240,255,0.15)] backdrop-blur-xl border border-cyan-400/50"
                    >
                      <div className="absolute top-0 right-0 bg-cyan-400/20 text-cyan-100 text-[10px] px-4 py-1 tracking-[0.3em] font-bold border-b border-l border-cyan-400/50">
                        A.I. MATRIX
                      </div>

                      <h2 className="text-cyan-300 uppercase tracking-[0.2em] font-display text-sm mb-5 border-b border-cyan-500/40 pb-3 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-yellow-400 animate-pulse" /> Output.Diagnostics
                      </h2>

                      <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-xs font-sans tracking-tight">
                        <div className="bg-cyan-950/60 p-3 border-l-[3px] border-cyan-400 hover:bg-cyan-900/60 transition-colors">
                          <p className="text-cyan-400/70 uppercase text-[10px] mb-1 font-display tracking-widest">System Status</p>
                          <p className="text-cyan-50 uppercase font-mono text-sm glow-text">{jarvisData.status}</p>
                        </div>
                        <div className="bg-cyan-950/60 p-3 border-l-[3px] border-cyan-400 hover:bg-cyan-900/60 transition-colors">
                          <p className="text-cyan-400/70 uppercase text-[10px] mb-1 font-display tracking-widest">Power Allocation</p>
                          <p className="text-cyan-50 uppercase font-mono text-sm glow-text">{jarvisData.power_output}</p>
                        </div>
                        
                        {jarvisData.diagnostic_metrics.map((metric, i) => (
                          <div key={i} className="bg-cyan-950/60 p-3 border-l-[3px] border-blue-500 hover:bg-cyan-900/60 transition-colors">
                            <p className="text-cyan-400/70 uppercase text-[10px] flex items-center gap-1 mb-1 font-display tracking-widest">
                              <Hash className="w-3 h-3 text-cyan-400"/> {metric.key}
                            </p>
                            <p className="text-cyan-100 uppercase font-mono">{metric.value}</p>
                          </div>
                        ))}
                      </div>

                      <div className="mt-6 pt-5 border-t border-cyan-500/40">
                         <p className="text-cyan-400/70 uppercase tracking-[0.3em] font-display text-[10px] mb-2">Resolution Render</p>
                         <p className="text-cyan-50 text-sm md:text-base leading-relaxed tracking-wide shadow-sm font-medium">
                           {jarvisData.query_result}
                         </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Decorative Data Column Right */}
              <div className="hidden lg:flex flex-col gap-5 text-[10px] font-mono opacity-60 w-56 order-3 text-right">
                 <div className="border-b border-cyan-400/40 pb-3">
                   <p className="tracking-[0.3em] font-display text-cyan-300 font-bold mb-1">ENVIRONMENTAL</p>
                   <p>CORE_TEMP: <span className="text-cyan-100">84&deg;C</span></p>
                   <p>EXT_PRES: <span className="text-cyan-100">14.7 PSI</span></p>
                   <p>RADIATION: <span className="text-cyan-100 glow-text">0.2 mSv</span></p>
                 </div>
                 <div className="border-b border-cyan-400/40 pb-3">
                   <p className="tracking-[0.3em] font-display text-cyan-300 font-bold mb-1">NETWORK_NODE</p>
                   <p>LATENCY: <span className="text-cyan-100">{Math.floor(Math.random() * 8 + 2)}ms</span></p>
                   <p>PACKET_LOSS: <span className="text-cyan-100">0.00%</span></p>
                 </div>
                 <div className="flex flex-col gap-1 items-end pt-2">
                   {[...Array(8)].map((_, i) => (
                     <p key={i} className="text-cyan-500 tracking-widest text-[9px] w-full text-right hover:text-cyan-300 hover:glow-text transition-colors">
                       [0x{Math.floor(Math.random()*16777215).toString(16).toUpperCase()}] .. OK
                     </p>
                   ))}
                 </div>
                 <div className="mt-auto pt-8">
                   <div className="flex justify-between text-cyan-300 mb-1 tracking-widest text-[9px] font-bold">
                     <span>CPU</span>
                     <span>64%</span>
                   </div>
                   <div className="w-full h-1.5 bg-cyan-900/80 rounded-full overflow-hidden shadow-[inset_0_0_5px_rgba(0,0,0,0.5)]">
                     <div className="w-[64%] h-full bg-cyan-400 shadow-[0_0_10px_#00f0ff]"></div>
                   </div>
                   <p className="mt-3 tracking-[0.3em] font-display text-cyan-400 font-bold">SYSTEM.ALLOC</p>
                 </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
