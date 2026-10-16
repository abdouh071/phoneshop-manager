import React, { useState } from 'react';
import { Smartphone, LogIn, Mail, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import styles from './LoginPage.module.css';

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isResetMode, setIsResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [activeTab, setActiveTab] = useState<'worker' | 'quick'>('worker');
  const [quickRole, setQuickRole] = useState<'sales_agent' | 'repair_agent'>('sales_agent');
  const [quickAdminPassword, setQuickAdminPassword] = useState('');
  
  const { login, quickRoleLogin, sendPasswordReset, isLoading, error, clearError } = useAuthStore();
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    await login(email, password);
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) return;
    try {
      await sendPasswordReset(resetEmail);
      setResetSent(true);
      toast.success(
        'Email Sent',
        `A password reset link has been sent to ${resetEmail}. Check your inbox.`
      );
    } catch (err: any) {
      toast.error('Error', err.message || 'Failed to send password reset email.');
    }
  };

  const toggleMode = () => {
    clearError();
    setIsResetMode(!isResetMode);
    setResetSent(false);
    setResetEmail('');
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {/* Login Tabs */}
        {!isResetMode && (
          <div style={{ display: 'flex', borderBottom: '1px solid var(--color-outline, #eee)' }}>
            <button
              onClick={() => { setActiveTab('worker'); clearError(); }}
              style={{
                flex: 1,
                padding: '12px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'worker' ? '2px solid var(--color-primary, #6366f1)' : '2px solid transparent',
                color: activeTab === 'worker' ? 'var(--color-primary, #6366f1)' : 'var(--color-on-surface-variant, #666)',
                fontWeight: activeTab === 'worker' ? 600 : 500,
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Worker Login
            </button>
            <button
              onClick={() => { setActiveTab('quick'); clearError(); }}
              style={{
                flex: 1,
                padding: '12px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'quick' ? '2px solid var(--color-primary, #6366f1)' : '2px solid transparent',
                color: activeTab === 'quick' ? 'var(--color-primary, #6366f1)' : 'var(--color-on-surface-variant, #666)',
                fontWeight: activeTab === 'quick' ? 600 : 500,
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Quick Role Login
            </button>
          </div>
        )}

        <div className={styles.header} style={{ marginTop: '16px' }}>
          <div className={styles.iconWrapper}>
            <Smartphone size={28} />
          </div>
          <h1 className={styles.title}>
            {isResetMode ? 'Reset Password' : 'Welcome Back'}
          </h1>
          <p className={styles.subtitle}>
            {isResetMode 
              ? 'Enter your email to receive a password reset link' 
              : 'Sign in to PhoneShop Manager Pro'}
          </p>
        </div>

        {!isResetMode ? (
          // LOGIN FORMS
          activeTab === 'worker' ? (
            <form onSubmit={handleSubmit} className={styles.form}>
              <Input 
                label="Email Address" 
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              
              <Input 
                label="Password" 
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-8px' }}>
                <button 
                  type="button" 
                  onClick={toggleMode}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-primary, #6366f1)',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: 500,
                    padding: 0
                  }}
                >
                  Forgot Password?
                </button>
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <Button 
                type="submit" 
                isLoading={isLoading} 
                leftIcon={!isLoading ? <LogIn size={18} /> : undefined}
                className={styles.submitBtn}
              >
                Sign In
              </Button>
            </form>
          ) : (
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!quickAdminPassword) return;
              await quickRoleLogin(quickRole, quickAdminPassword);
            }} className={styles.form}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <button
                  type="button"
                  onClick={() => setQuickRole('sales_agent')}
                  style={{
                    flex: 1, padding: '12px', borderRadius: '8px', border: quickRole === 'sales_agent' ? '2px solid var(--color-primary)' : '1px solid var(--color-outline)',
                    background: quickRole === 'sales_agent' ? 'var(--color-primary-container)' : 'var(--color-surface)',
                    cursor: 'pointer', textAlign: 'center', fontWeight: 600, color: quickRole === 'sales_agent' ? 'var(--color-on-primary-container)' : 'inherit'
                  }}
                >
                  🛒 Sales
                </button>
                <button
                  type="button"
                  onClick={() => setQuickRole('repair_agent')}
                  style={{
                    flex: 1, padding: '12px', borderRadius: '8px', border: quickRole === 'repair_agent' ? '2px solid var(--color-primary)' : '1px solid var(--color-outline)',
                    background: quickRole === 'repair_agent' ? 'var(--color-primary-container)' : 'var(--color-surface)',
                    cursor: 'pointer', textAlign: 'center', fontWeight: 600, color: quickRole === 'repair_agent' ? 'var(--color-on-primary-container)' : 'inherit'
                  }}
                >
                  🔧 Repair
                </button>
              </div>

              <Input 
                label="Admin Password" 
                type="password"
                placeholder="Enter Admin Password to unlock"
                value={quickAdminPassword}
                onChange={(e) => setQuickAdminPassword(e.target.value)}
                required
              />

              {error && <div className={styles.error}>{error}</div>}

              <Button 
                type="submit" 
                isLoading={isLoading} 
                leftIcon={!isLoading ? <LogIn size={18} /> : undefined}
                className={styles.submitBtn}
              >
                Unlock Terminal
              </Button>
            </form>
          )
        ) : (
          // PASSWORD RESET FORM
          <form onSubmit={handleResetSubmit} className={styles.form}>
            {resetSent ? (
              <div style={{
                padding: '16px',
                background: 'rgba(16,185,129,0.08)',
                color: '#10b981',
                borderRadius: '8px',
                fontSize: '14px',
                textAlign: 'center',
                lineHeight: 1.5
              }}>
                ✓ A secure link has been sent to your email. Click it to set a new password, then return here to log in.
              </div>
            ) : (
              <>
                <Input 
                  label="Email Address" 
                  type="email"
                  placeholder="name@example.com"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                />
                {error && <div className={styles.error}>{error}</div>}
                
                <Button 
                  type="submit" 
                  isLoading={isLoading} 
                  leftIcon={!isLoading ? <Mail size={18} /> : undefined}
                  className={styles.submitBtn}
                >
                  Send Reset Link
                </Button>
              </>
            )}

            <button 
              type="button"
              onClick={toggleMode}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: 'none',
                border: 'none',
                color: 'var(--color-on-surface-variant, #666)',
                fontSize: '14px',
                cursor: 'pointer',
                fontWeight: 500,
                marginTop: '12px',
                padding: 0
              }}
            >
              <ArrowLeft size={16} /> Back to Login
            </button>
          </form>
        )}

        <div className={styles.footer}>
          <p>Need help? Contact the Store Owner.</p>
        </div>
      </div>
    </div>
  );
};
