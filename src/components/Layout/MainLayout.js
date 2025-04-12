// src/components/Layout/MainLayout.js
import React from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import './MainLayout.css';

const MainLayout = ({ children, userName = "Usuário" }) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
  };

  return (
    <div className="layout-container">
      <Sidebar />
      <div className="content-area">
        <header className="header">
          <h1 className="header-title">Dashboard</h1>
          <div className="user-container">
            <div className="user-avatar">{userName.charAt(0)}</div>
            <span className="user-name">{userName}</span>
            <button className="logout-button" onClick={handleLogout}>
              Sair
            </button>
          </div>
        </header>
        <main className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
};

export default MainLayout;