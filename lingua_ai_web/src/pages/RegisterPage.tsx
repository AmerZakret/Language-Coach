import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { register as apiRegister } from '../api/authApi';
import { useAuth } from '../context/AuthContext';
// Removed unused Bot import
import { Button } from '../components/common/Button';
import './Auth.css';

export const RegisterPage: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const data = await apiRegister(name, email, password);
      login(data.user, data.access_token);
      navigate('/');
    } catch (err: any) {
      let errorMessage = 'Registration failed. Please try again.';
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

  return (
    <div className="auth-container">
      <div className="auth-card glass-panel animate-fade-in">
        <div className="auth-header">
          <div className="logo-container">
            <img src="/assets/images/logo.png" alt="LinguaAI Logo" className="auth-logo-img" />
          </div>
          <h2>Create Account</h2>
          <p>Join thousands of students learning languages.</p>
        </div>
        
        {error && <div className="auth-error">{error}</div>}
        
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Full Name</label>
            <input 
              type="text" 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              required 
              placeholder="Amer Zakret"
            />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required 
              placeholder="amer@example.com"
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
            Register
          </Button>
        </form>
        
        <div className="auth-footer">
          Already have an account? <Link to="/login">Login here</Link>
        </div>
      </div>
    </div>
  );
};
