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
    params,
  });
  return response.data;
};

export const createCommunityPost = async (formData: FormData): Promise<CommunityPost> => {
  const response = await apiClient.post<CommunityPost>('/community/posts', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const updateCommunityPost = async (id: string, formData: FormData): Promise<CommunityPost> => {
  const response = await apiClient.put<CommunityPost>(`/community/posts/${id}`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const deleteCommunityPost = async (id: string): Promise<{ success: boolean }> => {
  const response = await apiClient.delete<{ success: boolean }>(`/community/posts/${id}`);
  return response.data;
};

export const toggleLikeCommunityPost = async (id: string): Promise<{ likesCount: number; likedByMe: boolean }> => {
  const response = await apiClient.post<{ likesCount: number; likedByMe: boolean }>(`/community/posts/${id}/like`);
  return response.data;
};
