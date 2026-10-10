export type Role = 'viewer' | 'operator';

export interface User {
  id: string;
  email: string;
  role: Role;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
  expiresAt: number; 
}
