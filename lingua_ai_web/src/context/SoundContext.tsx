import React, { createContext, useContext, useState, useEffect } from 'react';
import { soundService } from '../utils/soundService';

interface SoundContextType {
  soundEnabled: boolean;
  toggleSound: () => void;
}

const SoundContext = createContext<SoundContextType>({
  soundEnabled: true,
  toggleSound: () => {},
});

export const SoundProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const stored = localStorage.getItem('sound_enabled');
    return stored !== null ? stored === 'true' : true;
  });

  useEffect(() => {
    localStorage.setItem('sound_enabled', String(soundEnabled));
    soundService.setEnabled(soundEnabled);
  }, [soundEnabled]);

  const toggleSound = () => {
    setSoundEnabled(prev => !prev);
  };

  return (
    <SoundContext.Provider value={{ soundEnabled, toggleSound }}>
      {children}
    </SoundContext.Provider>
  );
};

export const useSound = () => useContext(SoundContext);
