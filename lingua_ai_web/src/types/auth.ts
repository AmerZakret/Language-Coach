export interface User {
  id: string;
  name: string;
  email: string;
  isGuest: boolean;
  avatar?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isGuest: boolean;
}
