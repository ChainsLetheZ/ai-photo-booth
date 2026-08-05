
// Audio Service

export const SOUND_KEYS = {
    SHUTTER: 'SHUTTER',
    FIREWORKS: 'FIREWORKS',
    GESTURE_LOCK: 'GESTURE_LOCK',
    COUNTDOWN: 'COUNTDOWN',
    PRINT: 'PRINT',         
    ASSEMBLE: 'ASSEMBLE',   
    RESULT: 'RESULT',
    CHARGE_UP: 'CHARGE_UP',
    SYSTEM_READY: 'SYSTEM_READY',
    POP: 'POP',       
    SWOOSH: 'SWOOSH', 
    LOCK: 'LOCK',     
    MAGNETIC_CLICK: 'MAGNETIC_CLICK', // New
} as const;

type SoundKey = keyof typeof SOUND_KEYS;

const SOUND_URLS: Partial<Record<SoundKey, string>> = {
    // ⚠️ PLEASE PLACE YOUR MP3 FILES IN THE PUBLIC/ROOT DIRECTORY ⚠️
    FIREWORKS: '/fireworks.mp3',
    PRINT: '/print.mp3',       
    ASSEMBLE: '/assemble.mp3', 
    // SHUTTER URL Removed per user request
};

class AudioService {
    private context: AudioContext | null = null;
    private buffers: Map<string, AudioBuffer> = new Map();
    private activeSources: Map<string, AudioBufferSourceNode> = new Map(); // Track playing sounds
    private activeGains: Map<string, GainNode> = new Map(); // Track gains for fading
    private isMuted = false;
    
    // Charge Sound Nodes (Enhanced)
    private chargeOscillators: OscillatorNode[] = [];
    private chargeGain: GainNode | null = null;
    private chargeFilter: BiquadFilterNode | null = null;

    constructor() {
        if (typeof window !== 'undefined') {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) {
                this.context = new AudioContextClass();
                this.preloadSounds();
            }
        }
    }

    private async preloadSounds() {
        if (!this.context) return;
        
        for (const [key, url] of Object.entries(SOUND_URLS)) {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
                this.buffers.set(key, audioBuffer);
            } catch (e) {
                console.error(`AudioService: Failed to load ${key} from ${url}`, e);
            }
        }
    }

    public init() {
        if (this.context && this.context.state === 'suspended') {
            this.context.resume().catch(() => {});
        }
    }

    // --- Synthesized Sound Effects (No MP3 required) ---

    // 1. Gesture Lock: High-tech "Target Acquired" sound
    public playLock(volume: number = 0.2) {
        if (!this.context || this.isMuted) return;
        const t = this.context.currentTime;
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(1200, t + 0.1);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volume, t + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);

        osc.connect(gain);
        gain.connect(this.context.destination);
        osc.start(t);
        osc.stop(t + 0.2);
    }

    // 2. Pop / Reveal: Gentle bubble sound
    public playPop(volume: number = 0.3) {
        if (!this.context || this.isMuted) return;
        const t = this.context.currentTime;
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(600, t + 0.1);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volume, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);

        osc.connect(gain);
        gain.connect(this.context.destination);
        osc.start(t);
        osc.stop(t + 0.3);
    }

    // 3. Swoosh: White noise filter sweep (Approximation using oscillator for simplicity)
    public playSwoosh(volume: number = 0.15) {
        if (!this.context || this.isMuted) return;
        const t = this.context.currentTime;
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();

        osc.type = 'sine';
        // Pitch drop
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(50, t + 1.0);

        // Volume swell and fade
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volume, t + 0.2); // Fade in
        gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0); // Fade out

        osc.connect(gain);
        gain.connect(this.context.destination);
        osc.start(t);
        osc.stop(t + 1.0);
    }

    // 4. Magnetic Click: Heavy Metallic Thud
    public playMagneticClick(volume: number = 0.6) {
        if (!this.context || this.isMuted) return;
        const t = this.context.currentTime;
        
        // Part A: Low Frequency Impact (Thud)
        const osc1 = this.context.createOscillator();
        const gain1 = this.context.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(120, t);
        osc1.frequency.exponentialRampToValueAtTime(40, t + 0.2);
        
        gain1.gain.setValueAtTime(volume, t);
        gain1.gain.exponentialRampToValueAtTime(0.01, t + 0.3);

        osc1.connect(gain1);
        gain1.connect(this.context.destination);
        osc1.start(t);
        osc1.stop(t + 0.3);

        // Part B: High Frequency Click (Metal contact)
        const osc2 = this.context.createOscillator();
        const gain2 = this.context.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(2000, t);
        osc2.frequency.exponentialRampToValueAtTime(100, t + 0.05);

        gain2.gain.setValueAtTime(volume * 0.3, t);
        gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.05);

        osc2.connect(gain2);
        gain2.connect(this.context.destination);
        osc2.start(t);
        osc2.stop(t + 0.05);
    }

    public playBeep(frequency: number = 880, duration: number = 0.1) {
        if (!this.context || this.isMuted) return;
        if (this.context.state === 'suspended') this.context.resume().catch(() => {});

        const osc = this.context.createOscillator();
        const gain = this.context.createGain();

        osc.connect(gain);
        gain.connect(this.context.destination);

        osc.type = 'sine';
        osc.frequency.value = frequency;
        
        const now = this.context.currentTime;
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.start(now);
        osc.stop(now + duration);
    }

    // Standard Play for MP3s
    public play(key: SoundKey, volume: number = 0.5) {
        if (this.isMuted || !this.context) return;
        
        const buffer = this.buffers.get(key);
        if (!buffer) return;

        if (this.context.state === 'suspended') {
            this.context.resume().catch(() => {});
        }

        // Stop previous instance of same sound if any (monophonic per key)
        if (this.activeSources.has(key)) {
            try { this.activeSources.get(key)?.stop(); } catch(e) {}
        }

        const source = this.context.createBufferSource();
        source.buffer = buffer;
        
        const gainNode = this.context.createGain();
        gainNode.gain.value = volume;
        
        source.connect(gainNode);
        gainNode.connect(this.context.destination);
        
        source.start(0);

        // Track source and gain for later control (fade out)
        this.activeSources.set(key, source);
        this.activeGains.set(key, gainNode);

        source.onended = () => {
            this.activeSources.delete(key);
            this.activeGains.delete(key);
        };
    }

    // New: Fade out a specific sound over a duration
    public fadeOut(key: SoundKey, duration: number = 1.0) {
        if (!this.context) return;
        const gainNode = this.activeGains.get(key);
        const source = this.activeSources.get(key);

        if (gainNode && source) {
            const t = this.context.currentTime;
            // Cancel current changes
            gainNode.gain.cancelScheduledValues(t);
            // Set current value
            gainNode.gain.setValueAtTime(gainNode.gain.value, t);
            // Ramp to zero
            gainNode.gain.linearRampToValueAtTime(0, t + duration);
            
            // Stop source after fade
            setTimeout(() => {
                try { source.stop(); } catch(e) {}
                this.activeSources.delete(key);
                this.activeGains.delete(key);
            }, duration * 1000);
        }
    }

    public toggleMute(mute: boolean) {
        this.isMuted = mute;
    }
    
    /**
     * Engine Charge Sound
     * Replaced high pitch with a cinematic low-pass filtered spool-up sound.
     */
    public startCharge() {
        if (!this.context || this.isMuted) return;
        if (this.context.state === 'suspended') this.context.resume().catch(() => {});
        
        this.stopCharge();

        const t = this.context.currentTime;
        const DURATION = 2.5;

        // Create Master Gain for Charge
        this.chargeGain = this.context.createGain();
        this.chargeGain.connect(this.context.destination);
        this.chargeGain.gain.setValueAtTime(0, t);
        this.chargeGain.gain.linearRampToValueAtTime(0.6, t + DURATION);

        // Create a Low Pass Filter (The "Opening" effect)
        this.chargeFilter = this.context.createBiquadFilter();
        this.chargeFilter.type = 'lowpass';
        this.chargeFilter.frequency.setValueAtTime(50, t);
        this.chargeFilter.frequency.exponentialRampToValueAtTime(2000, t + DURATION);
        this.chargeFilter.connect(this.chargeGain);

        // 1. Sub Bass (Rumble)
        const subOsc = this.context.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(40, t);
        subOsc.frequency.linearRampToValueAtTime(100, t + DURATION);
        subOsc.connect(this.chargeGain); // Bypass filter for pure bass
        subOsc.start(t);
        this.chargeOscillators.push(subOsc);

        // 2. Texture (Sawtooth - The "Turbine" sound)
        const sawOsc = this.context.createOscillator();
        sawOsc.type = 'sawtooth';
        sawOsc.frequency.setValueAtTime(60, t);
        sawOsc.frequency.linearRampToValueAtTime(250, t + DURATION);
        
        // Detune a second one for "Chorus/Thickness" effect
        const sawOsc2 = this.context.createOscillator();
        sawOsc2.type = 'sawtooth';
        sawOsc2.frequency.setValueAtTime(62, t);
        sawOsc2.frequency.linearRampToValueAtTime(255, t + DURATION);

        sawOsc.connect(this.chargeFilter);
        sawOsc2.connect(this.chargeFilter);
        sawOsc.start(t);
        sawOsc2.start(t);
        this.chargeOscillators.push(sawOsc, sawOsc2);
    }

    public stopCharge() {
        const t = this.context?.currentTime || 0;
        
        if (this.chargeGain) {
            this.chargeGain.gain.cancelScheduledValues(t);
            this.chargeGain.gain.setValueAtTime(this.chargeGain.gain.value, t);
            this.chargeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15); // Slightly longer fade out
            this.chargeGain = null;
        }

        this.chargeOscillators.forEach(osc => {
            try {
                osc.stop(t + 0.15);
            } catch(e) {}
        });
        this.chargeOscillators = [];
        this.chargeFilter = null;
    }
}

export const audioService = new AudioService();
