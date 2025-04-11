// src/components/Dashboard/Dashboard.js
import React, { useState, useEffect } from "react";
import { auth, db } from "../../firebase/config";
import { signOut } from "firebase/auth";
import { doc, getDoc, collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import Transactions from "../Transactions/Transactions";
import "./Dashboard.css";

// Componente principal do Dashboard
const Dashboard = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [categoriesData, setCategoriesData] = useState(null);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [activeTab, setActiveTab] = useState("categories"); // 'categories', 'transactions' ou 'dre'
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserData = async () => {
      if (auth.currentUser) {
        setUser(auth.currentUser);
        
        try {
          // Buscar categorias do usuário
          const userCategoriesDoc = await getDoc(doc(db, "userCategories", auth.currentUser.uid));
          
          if (userCategoriesDoc.exists()) {
            const data = userCategoriesDoc.data();
            setCategoriesData(data);
          }
          
          // Buscar transações recentes para o usuário atual
          const transactionsQuery = query(
            collection(db, "transactions"),
            where("userId", "==", auth.currentUser.uid),
            orderBy("date", "desc"),
            limit(5)
          );
          
          const transactionsSnapshot = await getDocs(transactionsQuery);
          const transactionsData = [];
          
          transactionsSnapshot.forEach((doc) => {
            const data = doc.data();
            transactionsData.push({
              id: doc.id,
              ...data,
              date: data.date.toDate()
            });
          });
          
          setRecentTransactions(transactionsData);
        } catch (error) {
          console.error("Erro ao buscar dados:", error);
          setError("Houve um erro ao carregar seus dados. Por favor, tente novamente.");
        }
      }
      
      setLoading(false);
    };

    fetchUserData();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login");
    } catch (error) {
      console.error("Erro ao fazer logout:", error);
    }
  };

  // Função para navegar para a página do DRE
  const navigateToDRE = () => {
    navigate("/dre");
  };

  // Função para organizar as categorias em grupos e subgrupos
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

  // Formatar valor monetário
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  // Formatar data
  const formatDate = (date) => {
    return new Intl.DateTimeFormat('pt-BR').format(date);
  };

  if (loading) {
    return <div className="loading">Carregando...</div>;
  }

  const { groupedCategories, totalCategories } = organizeCategories();

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <div className="user-info">
          <span>Olá, {user?.displayName || "Usuário"}</span>
          <button className="logout-button" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message" style={{ 
          padding: '10px', 
          backgroundColor: '#ffebee', 
          color: '#c62828',
          borderRadius: '4px',
          marginBottom: '20px' 
        }}>
          {error}
        </div>
      )}

      <div className="dashboard-tabs">
        <button 
          className={`tab-button ${activeTab === 'categories' ? 'active' : ''}`}
          onClick={() => setActiveTab('categories')}
        >
          Categorias
        </button>
        <button 
          className={`tab-button ${activeTab === 'transactions' ? 'active' : ''}`}
          onClick={() => setActiveTab('transactions')}
        >
          Transações
        </button>
        <button 
          className={`tab-button ${activeTab === 'dre' ? 'active' : ''}`}
          onClick={() => navigateToDRE()}
        >
          DRE
        </button>
      </div>

      {activeTab === 'categories' ? (
        <div className="dashboard-content">
          <div className="dashboard-card">
            <h2>Suas Categorias Financeiras</h2>
            
            {totalCategories === 0 ? (
              <div className="no-categories">
                <p>Você ainda não selecionou nenhuma categoria.</p>
                <button 
                  className="select-categories-button"
                  onClick={() => navigate("/select-categories")}
                >
                  Selecionar Categorias
                </button>
              </div>
            ) : (
              <>
                <p className="categories-count">
                  Você selecionou {totalCategories} categorias.
                </p>
                
                <div className="categories-container">
                  {Object.entries(groupedCategories)
                    .sort(([, dataA], [, dataB]) => {
                      // Ordenar pelo campo order que adicionamos
                      return dataA.order - dataB.order;
                    })
                    .map(([groupName, groupData], index) => (
                      <div key={index} className="category-group">
                        <h3>{groupName}</h3>
                        
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
                          <div key={subIndex} className="category-subgroup-section">
                            <h4>{subGroupName}</h4>
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
                
                <div className="edit-categories">
                  <button 
                    className="edit-categories-button"
                    onClick={() => navigate("/select-categories")}
                  >
                    Editar Categorias
                  </button>
                </div>
              </>
            )}
          </div>

          {recentTransactions.length > 0 && (
            <div className="dashboard-card">
              <h2>
                Transações Recentes
                <button 
                  className="view-dre-button"
                  onClick={navigateToDRE}
                  style={{
                    float: 'right',
                    padding: '6px 12px',
                    backgroundColor: '#3498db',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Ver DRE
                </button>
              </h2>
              <div className="recent-transactions">
                <table className="transactions-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th>Categoria</th>
                      <th>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTransactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td>{formatDate(transaction.date)}</td>
                        <td>{transaction.description}</td>
                        <td>{transaction.category}</td>
                        <td className={transaction.amount >= 0 ? 'amount-positive' : 'amount-negative'}>
                          {formatCurrency(transaction.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                <button 
                  className="view-all-button"
                  onClick={() => setActiveTab('transactions')}
                >
                  Ver Todas as Transações
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <Transactions />
      )}
    </div>
  );
};

export default Dashboard;