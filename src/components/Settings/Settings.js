// src/components/Settings/Settings.js
import React, { useState, useEffect } from "react";
import { auth, db } from "../../firebase/config";
import { doc, getDoc } from "firebase/firestore";
import { Link } from "react-router-dom";
import MainLayout from "../Layout/MainLayout";
import AccountForm from "./AccountForm";
import "./Settings.css";

const Settings = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("account");
  const [categoriesData, setCategoriesData] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Carregar dados do usuário e categorias
  useEffect(() => {
    const loadUserData = async () => {
      try {
        setLoading(true);
        
        if (auth.currentUser) {
          const currentUser = auth.currentUser;
          setUser(currentUser);
          
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

  // Componente para a aba de Categorias
  const CategoriesTab = () => {
    const { groupedCategories, totalCategories } = organizeCategories();
    
    return (
      <div className="settings-tab-content">
        <div className="categories-header">
          <h3>Suas Categorias Financeiras</h3>
          <Link to="/select-categories" className="edit-categories-button">
            Editar Categorias
          </Link>
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
              {activeTab === 'account' && (
                <AccountForm 
                  user={user} 
                  setError={setError} 
                  setSuccess={setSuccess} 
                />
              )}
              {activeTab === 'categories' && <CategoriesTab />}
            </>
          )}
        </div>
      </div>
    </MainLayout>
  );
};

export default Settings;