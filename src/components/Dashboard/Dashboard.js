// src/components/Dashboard/Dashboard.js
import React, { useState, useEffect } from "react";
import { auth, db } from "../../firebase/config";
import { doc, getDoc, collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import MainLayout from "../Layout/MainLayout";
import "./Dashboard.css";

const Dashboard = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [categoriesData, setCategoriesData] = useState(null);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [error, setError] = useState("");

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
    return (
      <MainLayout>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Carregando dados...</p>
        </div>
      </MainLayout>
    );
  }

  const { groupedCategories, totalCategories } = organizeCategories();

  return (
    <MainLayout userName={user?.displayName || "Usuário"}>
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Cards Financeiros */}
      <div className="card-container">
        <div className="fin-card fin-card-receipts">
          <div className="fin-card-title">RECEITAS</div>
          <div className="fin-card-value">R$ 24.850,00</div>
          <div className="fin-card-description">Total de receitas no período</div>
          <div className="fin-card-footer">
            <div className="empty-space"></div>
          </div>
        </div>

        <div className="fin-card fin-card-costs">
          <div className="fin-card-title">CUSTOS DIRETOS</div>
          <div className="fin-card-value">R$ 12.430,00</div>
          <div className="fin-card-description">Total de custos diretos</div>
          <div className="fin-card-footer">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: '50%', backgroundColor: '#00acc1' }}></div>
            </div>
            <div className="progress-text">50% das receitas</div>
          </div>
        </div>

        <div className="fin-card fin-card-profit">
          <div className="fin-card-title">LUCRO BRUTO</div>
          <div className="fin-card-value">R$ 12.420,00</div>
          <div className="fin-card-description">Receitas - Custos Diretos</div>
          <div className="fin-card-footer">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: '50%', backgroundColor: '#2196f3' }}></div>
            </div>
            <div className="progress-text">50% das receitas</div>
          </div>
        </div>

        <div className="fin-card fin-card-result">
          <div className="fin-card-title">RESULTADO FINAL</div>
          <div className="fin-card-value">R$ 10.850,00</div>
          <div className="fin-card-description">Lucro Bruto - Despesas</div>
          <div className="fin-card-footer">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: '44%', backgroundColor: '#ff9800' }}></div>
            </div>
            <div className="progress-text">44% das receitas</div>
          </div>
        </div>
      </div>

      {/* Categorias */}
      <div className="categories-section">
        <div className="section-header">
          <h2 className="section-title">Suas Categorias Financeiras</h2>
          <button className="edit-categories-button">
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

      {/* Transações recentes */}
      {recentTransactions.length > 0 && (
        <div className="transactions-section">
          <div className="section-header">
            <h2 className="section-title">Transações Recentes</h2>
            <button className="view-all-button">
              Ver Todas as Transações
            </button>
          </div>
          
          <div className="transactions-table-container">
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
                    <td>
                      <span className="category-badge">{transaction.category}</span>
                    </td>
                    <td className={transaction.amount >= 0 ? 'amount-positive' : 'amount-negative'}>
                      {formatCurrency(transaction.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </MainLayout>
  );
};

export default Dashboard;