class SoundService {
  private correctSound: HTMLAudioElement;
  private wrongSound: HTMLAudioElement;
  private clickSound: HTMLAudioElement;
  private enabled: boolean = true;

  constructor() {
    this.correctSound = new Audio('/sounds/correct.wav');
    this.wrongSound = new Audio('/sounds/wrong.wav');
    this.clickSound = new Audio('/sounds/click.wav');
    
    // Load setting from localStorage
    const stored = localStorage.getItem('sound_enabled');
    if (stored !== null) {
      this.enabled = stored === 'true';
    }
;
    // Preload sounds
    this.correctSound.load();
    this.wrongSound.load();
    this.clickSound.load();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  private playSound(audio: HTMLAudioElement) {
    if (!this.enabled) return;
    try {
      // Reset sound before playing so rapid clicks work properly
      audio.currentTime = 0;
      const playPromise = audio.play();
      
      // Handle the Promise returned by play() to silently catch DOMExceptions 
      // (e.g. if the user hasn't interacted with the document yet)
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Silently ignore errors
        });
      }
    } catch (e) {
      // Silently ignore synchronous errors
    }
  }

  playCorrect() {
    this.playSound(this.correctSound);
  }

  playWrong() {
    this.playSound(this.wrongSound);
  }

  playClick() {
    this.playSound(this.clickSound);
  }
}

// Export as a singleton service
export const soundService = new SoundService();
