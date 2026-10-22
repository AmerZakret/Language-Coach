import { mutationRequest, newMutationId } from './mutationRequest';
import { targetLanguageCode, targetLanguageName, tryTargetLanguageCode } from '../utils/targetLanguage';
import apiClient from './apiClient';

export interface CommunityPost {
  _id: string;
  userId: string;
  userName: string;
  learningLanguage: string;
  text?: string;
  imageUrl?: string;
  likes: string[];
  likesCount: number;
  likedByMe?: boolean;
  createdAt: string;
  updatedAt: string;
  revision?: number;
}

export interface GetCommunityPostsResponse {
  items: CommunityPost[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export const getCommunityPosts = async (params: {
  page?: number;
  limit?: number;
  language?: string;
}): Promise<GetCommunityPostsResponse> => {
  const response = await apiClient.get<GetCommunityPostsResponse>('/community/posts', {
    params: { ...params, ...(params.language && params.language.toLowerCase() !== 'all' ? { language: targetLanguageCode(params.language) } : {}) },
  });
  return { ...response.data, items: response.data.items.map(displayPost) };
};

export const createCommunityPost = async (formData: FormData, operationId = newMutationId()): Promise<CommunityPost> => {
  const language = formData.get('learningLanguage');
  if (language != null) formData.set('learningLanguage', targetLanguageCode(language));
  const response = await mutationRequest(operationId, config => apiClient.post<CommunityPost>('/community/posts', formData, { ...config,
    headers: { ...config.headers, 'Content-Type': 'multipart/form-data' },
  }));
  return displayPost(response.data);
};

export const updateCommunityPost = async (id: string, formData: FormData, operationId = newMutationId()): Promise<CommunityPost> => {
  const response = await mutationRequest(operationId, config => apiClient.put<CommunityPost>(`/community/posts/${id}`, formData, { ...config,
    headers: { ...config.headers, 'Content-Type': 'multipart/form-data' },
  }));
  return displayPost(response.data);
};

export const deleteCommunityPost = async (id: string, revision: number, operationId = newMutationId()): Promise<{ success: boolean }> => {
  const response = await mutationRequest(operationId, config => apiClient.delete<{ success: boolean }>(`/community/posts/${id}`, { ...config, headers: { ...config.headers, 'X-Resource-Revision': revision } }));
  return response.data;
};

export const toggleLikeCommunityPost = async (id: string, liked: boolean, operationId = newMutationId()): Promise<{ likesCount: number; likedByMe: boolean }> => {
  const response = await mutationRequest(operationId, config => apiClient.post<{ likesCount: number; likedByMe: boolean }>(`/community/posts/${id}/like`, { liked }, config), `reaction:${id}`);
  return response.data;
};

const displayPost = (post: CommunityPost): CommunityPost => ({ ...post,
  learningLanguage: tryTargetLanguageCode(post.learningLanguage) ? targetLanguageName(post.learningLanguage) : post.learningLanguage,
});
