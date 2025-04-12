// src/components/Settings/Settings.js
import React, { useState, useEffect } from "react";
import { auth, db } from "../../firebase/config";
import { 
  doc, 
  getDoc,
  updateDoc, 
  serverTimestamp 
} from "firebase/firestore";
import { updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import MainLayout from "../Layout/MainLayout";
import "./Settings.css";

const Settings = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("account");
  const [categoriesData, setCategoriesData] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  // Estados para o formulário da conta
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  
  // Estado para armazenar informações da senha atual para reautenticação
  const [reAuthPassword, setReAuthPassword] = useState("");
  const [showReAuth, setShowReAuth] = useState(false);
  
  const navigate = useNavigate();

  // Carregar dados do usuário e categorias
  useEffect(() => {
    const loadUserData = async () => {
      try {
        setLoading(true);
        
        if (auth.currentUser) {
          const currentUser = auth.currentUser;
          setUser(currentUser);
          setDisplayName(currentUser.displayName || "");
          setEmail(currentUser.email || "");
          
          // Carregar categorias do usuário
          await loadUserCategories(currentUser.uid);
        }
      } catch (error) {
        console.error("Erro ao carregar dados do usuário:", error);
        setError("Não foi possível carregar seus dados. Tente novamente.");
      } finally {
        setLoading(false);
      }
    };
    
    loadUserData();
  }, []);

  // Carregar categorias do usuário
  const loadUserCategories = async (userId) => {
    try {
      const userCategoriesDoc = await getDoc(doc(db, "userCategories", userId));
      
      if (userCategoriesDoc.exists()) {
        const data = userCategoriesDoc.data();
        setCategoriesData(data);
      }
    } catch (error) {
      console.error("Erro ao carregar categorias do usuário:", error);
      setError("Não foi possível carregar suas categorias.");
    }
  };

  // Função para salvar mudanças de perfil
  const handleSaveProfile = async () => {
    try {
      setLoading(true);
      setError("");
      setSuccess("");
      
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Usuário não autenticado.");
      }
      
      // Atualizar displayName no Firestore (se implementado)
      const userDocRef = doc(db, "users", currentUser.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        await updateDoc(userDocRef, {
          displayName: displayName,
          updatedAt: serverTimestamp()
        });
      }
      
      // Atualizar email (requer reautenticação)
      if (email !== currentUser.email) {
        if (!reAuthPassword) {
          setShowReAuth(true);
          return;
        }
        
        try {
          // Reautenticar usuário
          const credential = EmailAuthProvider.credential(
            currentUser.email,
            reAuthPassword
          );
          
          await reauthenticateWithCredential(currentUser, credential);
          
          // Atualizar email
          await updateEmail(currentUser, email);
          
          setShowReAuth(false);
          setReAuthPassword("");
        } catch (authError) {
          console.error("Erro de autenticação:", authError);
          setError("Senha atual incorreta ou erro ao atualizar email.");
          return;
        }
      }
      
      // Atualizar senha (se fornecida)
      if (newPassword && currentPassword) {
        try {
          // Reautenticar usuário
          const credential = EmailAuthProvider.credential(
            currentUser.email,
            currentPassword
          );
          
          await reauthenticateWithCredential(currentUser, credential);
          
          // Atualizar senha
          await updatePassword(currentUser, newPassword);
          
          // Limpar campos de senha
          setNewPassword("");
          setCurrentPassword("");
          setShowPasswordChange(false);
        } catch (authError) {
          console.error("Erro ao alterar senha:", authError);
          setError("Senha atual incorreta ou erro ao atualizar senha.");
          return;
        }
      }
      
      setSuccess("Perfil atualizado com sucesso!");
      
      // Limpar mensagem após 3 segundos
      setTimeout(() => {
        setSuccess("");
      }, 3000);
      
    } catch (error) {
      console.error("Erro ao salvar perfil:", error);
      setError(`Erro ao atualizar perfil: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Organizar as categorias em grupos
  const organizeCategories = () => {
    if (!categoriesData || !categoriesData.categories) {
      return {
        groupedCategories: {},
        totalCategories: 0
      };
    }

    const categories = categoriesData.categories;
    const categoryOrder = categoriesData.categoryOrder || {};
    
    const selectedKeys = Object.keys(categories).filter(key => categories[key] === true);
    const groupedCategories = {};

    // Processar cada chave
    selectedKeys.forEach(key => {
      const parts = key.split('.');
      
      // Obter o grupo (primeira parte)
      const groupName = parts[0];
      
      // Inicializar o grupo se não existir
      if (!groupedCategories[groupName]) {
        // Usar a ordem se disponível, ou um número alto para categorias sem ordem
        const order = categoryOrder[groupName] || 999;
        groupedCategories[groupName] = {
          normalCategories: [],
          subGroups: {},
          order: order
        };
      }
      
      // Verificar se tem 2 ou 3 partes (com ou sem subgrupo)
      if (parts.length === 2) {
        // Sem subgrupo: grupo.categoria
        groupedCategories[groupName].normalCategories.push(parts[1]);
      } else if (parts.length === 3) {
        // Com subgrupo: grupo.subgrupo.categoria
        const subGroupName = parts[1];
        const categoryName = parts[2];
        
        if (!groupedCategories[groupName].subGroups[subGroupName]) {
          groupedCategories[groupName].subGroups[subGroupName] = [];
        }
        
        groupedCategories[groupName].subGroups[subGroupName].push(categoryName);
      }
    });

    return {
      groupedCategories,
      totalCategories: selectedKeys.length
    };
  };

  // Navegar para a página de seleção de categorias
  const handleEditCategories = () => {
    navigate("/select-categories");
  };
  
  // Componente para a aba de Conta
  const AccountTab = () => (
    <div className="settings-tab-content">
      <h3>Informações da Conta</h3>
      
      <div className="settings-form">
        <div className="form-group">
          <label htmlFor="displayName">Nome</label>
          <input
            type="text"
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={loading}
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
        </div>
        
        {showPasswordChange ? (
          <>
            <div className="form-group">
              <label htmlFor="currentPassword">Senha Atual</label>
              <input
                type="password"
                id="currentPassword"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="newPassword">Nova Senha</label>
              <input
                type="password"
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            
            <div className="password-actions">
              <button 
                className="cancel-button"
                onClick={() => {
                  setShowPasswordChange(false);
                  setCurrentPassword("");
                  setNewPassword("");
                }}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <button 
            className="show-password-button"
            onClick={() => setShowPasswordChange(true)}
            disabled={loading}
          >
            Alterar Senha
          </button>
        )}
        
        <button 
          className="save-button"
          onClick={handleSaveProfile}
          disabled={loading}
        >
          {loading ? "Salvando..." : "Salvar Alterações"}
        </button>
      </div>
      
      {/* Modal de reautenticação (se necessário para alterar email) */}
      {showReAuth && (
        <div className="reauth-modal-overlay">
          <div className="reauth-modal">
            <h4>Verifique sua Identidade</h4>
            <p>Para alterar seu email, precisamos confirmar sua senha atual.</p>
            
            <div className="form-group">
              <label htmlFor="reAuthPassword">Senha Atual</label>
              <input
                type="password"
                id="reAuthPassword"
                value={reAuthPassword}
                onChange={(e) => setReAuthPassword(e.target.value)}
              />
            </div>
            
            <div className="reauth-buttons">
              <button 
                className="cancel-button"
                onClick={() => {
                  setShowReAuth(false);
                  setReAuthPassword("");
                  setEmail(user.email); // Reverter para email original
                }}
              >
                Cancelar
              </button>
              
              <button 
                className="confirm-button"
                onClick={handleSaveProfile}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  
  // Componente para a aba de Categorias
  const CategoriesTab = () => {
    const { groupedCategories, totalCategories } = organizeCategories();
    
    return (
      <div className="settings-tab-content">
        <div className="categories-header">
          <h3>Suas Categorias Financeiras</h3>
          <button 
            className="edit-categories-button"
            onClick={handleEditCategories}
          >
            Editar Categorias
          </button>
        </div>
        
        <p className="categories-count">
          Você selecionou {totalCategories} categorias.
        </p>
        
        <div className="categories-grid">
          {Object.entries(groupedCategories)
            .sort(([, dataA], [, dataB]) => {
              return dataA.order - dataB.order;
            })
            .map(([groupName, groupData], index) => (
              <div key={index} className="category-group">
                <div className="category-group-header">{groupName}</div>
                
                {/* Categorias normais (sem subgrupo) */}
                {groupData.normalCategories.length > 0 && (
                  <ul className="category-list">
                    {groupData.normalCategories.map((category, catIndex) => (
                      <li key={catIndex} className="category-item">{category}</li>
                    ))}
                  </ul>
                )}
                
                {/* Categorias com subgrupos */}
                {Object.entries(groupData.subGroups).map(([subGroupName, categories], subIndex) => (
                  <div key={subIndex} className="category-subgroup">
                    <h4 className="subgroup-title">{subGroupName}</h4>
                    <ul className="category-list">
                      {categories.map((category, catIndex) => (
                        <li key={catIndex} className="category-item">{category}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    );
  };

  return (
    <MainLayout userName={user?.displayName || "Usuário"}>
      <div className="settings-container">
        <div className="settings-header">
          <h1>Configurações</h1>
        </div>
        
        {error && (
          <div className="error-message">
            <button className="close-message" onClick={() => setError("")}>×</button>
            {error}
          </div>
        )}
        
        {success && (
          <div className="success-message">
            <button className="close-message" onClick={() => setSuccess("")}>×</button>
            {success}
          </div>
        )}
        
        <div className="settings-tabs">
          <button 
            className={`tab-button ${activeTab === 'account' ? 'active' : ''}`}
            onClick={() => setActiveTab('account')}
          >
            Conta
          </button>
          <button 
            className={`tab-button ${activeTab === 'categories' ? 'active' : ''}`}
            onClick={() => setActiveTab('categories')}
          >
            Categorias Financeiras
          </button>
        </div>
        
        <div className="settings-content">
          {loading ? (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <p>Carregando configurações...</p>
            </div>
          ) : (
            <>
              {activeTab === 'account' && <AccountTab />}
              {activeTab === 'categories' && <CategoriesTab />}
            </>
          )}
        </div>
      </div>
    </MainLayout>
  );
};

export default Settings;