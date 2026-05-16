import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login as apiLogin } from '../api/authApi';
import { useAuth } from '../context/AuthContext';
import { User } from 'lucide-react';
import { Button } from '../components/common/Button';
import './Auth.css';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const navigate = useNavigate();
  const { login, loginAsGuest } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const data = await apiLogin(email, password);
      login(data.user, data.access_token);
      navigate('/');
    } catch (err: any) {
      let errorMessage = 'Login failed. Please try again.';
      if (err.response?.data?.message) {
        errorMessage = Array.isArray(err.response.data.message) 
          ? err.response.data.message.join(', ') 
          : err.response.data.message;
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = () => {
    loginAsGuest();
    navigate('/');
  };

  return (
    <div className="auth-container">
      <div className="auth-card glass-panel animate-fade-in">
        <div className="auth-header">
          <div className="logo-container">
            <img src="/assets/images/logo.png" alt="LinguaAI Logo" className="auth-logo-img" />
          </div>
          <h2>LinguaAI</h2>
          <p>Login to continue your learning journey.</p>
        </div>
        
        {error && <div className="auth-error">{error}</div>}
        
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Email</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required 
              placeholder="admin@example.com"
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              required 
              placeholder="••••••••"
            />
          </div>
          <Button type="submit" isLoading={loading} className="full-width">
            Login
          </Button>
        </form>

        <div className="auth-divider">
          <span>OR</span>
        </div>

        <Button variant="outline" className="full-width" onClick={handleGuest} leftIcon={<User size={18} />}>
          Continue as Guest
        </Button>
        
        <div className="auth-footer">
          Don't have an account? <Link to="/register">Register here</Link>
        </div>
      </div>
    </div>
  );
};
