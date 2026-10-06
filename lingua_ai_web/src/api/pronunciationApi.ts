import apiClient from './apiClient';

export interface PronunciationAssessmentResult {
  targetText: string;
  recognizedText: string;
  targetLanguage: string;
  pronunciationScore: number;
  result: 'correct' | 'almost' | 'try_again';
  aiFeedback: string;
  provider: string;
}

export interface AssessPronunciationRequest {
  audio: Blob | File;
  targetText: string;
  targetLanguage: string;
  nativeTranslation?: string;
  nativeLanguage?: string;
  sourceType?: 'flashcard' | 'lesson' | 'manual';
}

export const assessPronunciation = async (
  request: AssessPronunciationRequest,
): Promise<PronunciationAssessmentResult> => {
  const formData = new FormData();
  formData.append('audio', request.audio, 'audio.webm');
  formData.append('targetText', request.targetText);
  formData.append('targetLanguage', request.targetLanguage);
  
  if (request.nativeTranslation) {
    formData.append('nativeTranslation', request.nativeTranslation);
  }
  if (request.nativeLanguage) {
    formData.append('nativeLanguage', request.nativeLanguage);
  }
  if (request.sourceType) {
    formData.append('sourceType', request.sourceType);
  }

  const response = await apiClient.post<PronunciationAssessmentResult>(
    '/pronunciation/assess',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    },
  );
  return response.data;
};
