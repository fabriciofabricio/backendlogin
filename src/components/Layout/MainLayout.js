// src/components/Layout/MainLayout.js
import React, { useState, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../../firebase/config';
import { useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import './MainLayout.css';

// Chave para armazenar no localStorage
const SIDEBAR_STATE_KEY = 'sidebar_collapsed_state';

const MainLayout = ({ children, userName = "Usuário" }) => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Inicializar o estado usando o valor armazenado no localStorage
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      // Tenta ler o estado salvo no localStorage
      const savedState = localStorage.getItem(SIDEBAR_STATE_KEY);
      // Retorna o valor salvo ou false como padrão
      return savedState === 'true';
    } catch (error) {
      console.error('Erro ao ler do localStorage:', error);
      return false;
    }
  });

  // Efeito para sincronizar o estado com o localStorage sempre que mudar
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STATE_KEY, String(sidebarCollapsed));
      console.log(`Estado da sidebar salvo: ${sidebarCollapsed}`);
    } catch (error) {
      console.error('Erro ao salvar no localStorage:', error);
    }
  }, [sidebarCollapsed]);

  // Efeito para garantir que o estado seja recarregado quando a rota mudar
  useEffect(() => {
    try {
      const savedState = localStorage.getItem(SIDEBAR_STATE_KEY);
      const isCollapsed = savedState === 'true';
      
      // Se o estado atual for diferente do salvo, atualiza
      if (sidebarCollapsed !== isCollapsed) {
        setSidebarCollapsed(isCollapsed);
        console.log(`Estado da sidebar atualizado na mudança de rota: ${isCollapsed}`);
      }
    } catch (error) {
      console.error('Erro ao recarregar o estado da sidebar:', error);
    }
  }, [location.pathname]); // Dependência: caminho da URL

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
  };

  const toggleSidebar = () => {
    // Alterna o estado e atualiza o localStorage
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    console.log(`Sidebar alternada para: ${newState}`);
  };

  return (
    <div className={`layout-container ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={sidebarCollapsed} />
      <div className="content-area">
        <header className="header">
          <div className="header-left">
            <button 
              className="toggle-sidebar-button" 
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "Expandir menu" : "Colapsar menu"}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
          </div>
          
          <div className="header-right">
            <div className="user-container">
              <div className="user-avatar">{userName.charAt(0)}</div>
              <span className="user-name">{userName}</span>
              <button className="logout-button" onClick={handleLogout}>
                Sair
              </button>
            </div>
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