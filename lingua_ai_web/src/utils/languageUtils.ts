export const getLanguageFlag = (lang: string): string => {
  switch (lang) {
    case 'English':
      return '🇺🇸';
    case 'Turkish':
      return '🇹🇷';
    case 'German':
      return '🇩🇪';
    case 'French':
      return '🇫🇷';
    case 'Spanish':
      return '🇪🇸';
    case 'Arabic':
      return '🇸🇦';
    default:
      return '🌐'; // Neutral globe icon
  }
};
