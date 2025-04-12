// src/components/Categories/CategoryDetails.js
import React, { useState, useEffect } from "react";
import { auth, db, storage } from "../../firebase/config";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { ref, getBlob } from "firebase/storage";
import { parseOFXContent } from "../../utils/OFXParser";
import MainLayout from "../Layout/MainLayout";
import "./CategoryDetails.css";

const CategoryDetails = () => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState("");
  const [categoryMappings, setCategoryMappings] = useState({});
  const [totalAmount, setTotalAmount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const transactionsPerPage = 10;

  // Carregar usuário, períodos e categorias
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        
        if (auth.currentUser) {
          setUser(auth.currentUser);
          
          // Carregar períodos disponíveis
          await loadAvailablePeriods();
          
          // Carregar categorias do usuário
          await loadUserCategories();
          
          // Carregar mapeamentos de categorias
          await loadCategoryMappings();
        }
      } catch (error) {
        console.error("Erro ao carregar dados iniciais:", error);
        setError("Não foi possível carregar os dados iniciais.");
      } finally {
        setLoading(false);
      }
    };
    
    loadInitialData();
  }, []);

  // Carregar períodos disponíveis
  const loadAvailablePeriods = async () => {
    try {
      if (!auth.currentUser) return;
      
      const periodsQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", auth.currentUser.uid)
      );
      
      const periodsSnapshot = await getDocs(periodsQuery);
      const uniquePeriods = [];
      const periodsSet = new Set();
      
      periodsSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.period && !periodsSet.has(data.period)) {
          periodsSet.add(data.period);
          uniquePeriods.push({
            value: data.period,
            label: data.periodLabel || data.period
          });
        }
      });
      
      // Ordenar os períodos (mais recente primeiro)
      uniquePeriods.sort((a, b) => b.value.localeCompare(a.value));
      setPeriods(uniquePeriods);
      
      // Verificar se existe um período salvo no localStorage
      let savedPeriod = localStorage.getItem('selectedPeriod');
      let periodToUse;
      
      if (savedPeriod && uniquePeriods.find(p => p.value === savedPeriod)) {
        // Se existir um período salvo e ele estiver disponível, usar ele
        periodToUse = savedPeriod;
      } else if (uniquePeriods.length > 0) {
        // Caso contrário, usar o período mais recente
        periodToUse = uniquePeriods[0].value;
        // Salvar no localStorage
        localStorage.setItem('selectedPeriod', periodToUse);
      }
      
      if (periodToUse) {
        setSelectedPeriod(periodToUse);
      }
    } catch (error) {
      console.error("Erro ao carregar períodos:", error);
      setError("Não foi possível carregar os períodos disponíveis.");
    }
  };

  // Carregar categorias do usuário
  const loadUserCategories = async () => {
    try {
      if (!auth.currentUser) return;
      
      const userCategoriesDoc = await getDoc(doc(db, "userCategories", auth.currentUser.uid));
      
      if (userCategoriesDoc.exists()) {
        const categoriesData = userCategoriesDoc.data();
        
        if (categoriesData.categories) {
          // Processar categorias para formato utilizável
          const flatCategories = [];
          
          Object.keys(categoriesData.categories).forEach(key => {
            if (categoriesData.categories[key]) {
              const parts = key.split('.');
              
              if (parts.length === 2) {
                const group = parts[0];
                const category = parts[1];
                
                flatCategories.push({
                  fullPath: key,
                  group,
                  category,
                  displayName: category // Apenas o nome da categoria, sem o grupo
                });
              }
            }
          });
          
          // Ordenar categorias por grupo e depois por nome
          flatCategories.sort((a, b) => {
            if (a.group !== b.group) {
              return a.group.localeCompare(b.group);
            }
            return a.category.localeCompare(b.category);
          });
          
          setCategories(flatCategories);
          
          // Se houver categorias, pré-selecionar a primeira
          if (flatCategories.length > 0) {
            setSelectedCategory(flatCategories[0].fullPath);
          }
        }
      }
    } catch (error) {
      console.error("Erro ao carregar categorias:", error);
      setError("Não foi possível carregar suas categorias.");
    }
  };

  // Carregar mapeamentos de categorias
  const loadCategoryMappings = async () => {
    try {
      if (!auth.currentUser) return;
      
      const mappingsDoc = await getDoc(doc(db, "categoryMappings", auth.currentUser.uid));
      
      if (mappingsDoc.exists() && mappingsDoc.data().mappings) {
        setCategoryMappings(mappingsDoc.data().mappings);
      }
    } catch (error) {
      console.error("Erro ao carregar mapeamentos de categorias:", error);
      setError("Não foi possível carregar os mapeamentos de categorias.");
    }
  };

  // Efeito para carregar transações quando mudar período ou categoria
  useEffect(() => {
    if (selectedPeriod && selectedCategory) {
      loadTransactionsForCategory();
    }
  }, [selectedPeriod, selectedCategory, categoryMappings]);

  // Carregar transações para a categoria selecionada
  const loadTransactionsForCategory = async () => {
    try {
      setLoading(true);
      
      if (!auth.currentUser || !selectedPeriod || !selectedCategory) return;
      
      // Extrair grupo e categoria da seleção
      const selectedCategoryParts = selectedCategory.split('.');
      if (selectedCategoryParts.length !== 2) return;
      
      const selectedGroup = selectedCategoryParts[0];
      const selectedCategoryName = selectedCategoryParts[1];
      
      // Buscar arquivos OFX do período selecionado
      const ofxFilesQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", auth.currentUser.uid),
        where("period", "==", selectedPeriod)
      );
      
      const ofxFilesSnapshot = await getDocs(ofxFilesQuery);
      const transactionsForCategory = [];
      let totalAmountForCategory = 0;
      
      // Processar cada arquivo OFX
      for (const fileDoc of ofxFilesSnapshot.docs) {
        const fileData = fileDoc.data();
        
        if (fileData.filePath) {
          try {
            const storageRef = ref(storage, fileData.filePath);
            const blob = await getBlob(storageRef);
            const fileContent = await blob.text();
            const parseResult = parseOFXContent(fileContent);
            const transactions = parseResult.transactions;
            
            // Filtrar transações pela categoria selecionada
            transactions.forEach(transaction => {
              const normalizedDescription = transaction.description.trim().toLowerCase();
              
              if (categoryMappings[normalizedDescription]) {
                const mapping = categoryMappings[normalizedDescription];
                
                // Verificar se a transação pertence à categoria e grupo selecionados
                if (
                  mapping.groupName === selectedGroup && 
                  mapping.categoryName === selectedCategoryName
                ) {
                  transactionsForCategory.push({
                    ...transaction,
                    date: new Date(transaction.date),
                    fileId: fileDoc.id,
                    fileName: fileData.fileName
                  });
                  
                  totalAmountForCategory += transaction.amount;
                }
              }
            });
          } catch (error) {
            console.error(`Erro ao processar arquivo OFX ${fileData.fileName}:`, error);
          }
        }
      }
      
      // Ordenar transações por data (mais recente primeiro)
      transactionsForCategory.sort((a, b) => b.date - a.date);
      
      setTransactions(transactionsForCategory);
      setTotalAmount(totalAmountForCategory);
      
      // Calcular total de páginas
      setTotalPages(Math.max(1, Math.ceil(transactionsForCategory.length / transactionsPerPage)));
      setCurrentPage(1); // Resetar para a primeira página
    } catch (error) {
      console.error("Erro ao carregar transações:", error);
      setError("Não foi possível carregar as transações para esta categoria.");
    } finally {
      setLoading(false);
    }
  };

  // Função para formatar valores monetários
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  // Função para formatar data
  const formatDate = (date) => {
    return new Intl.DateTimeFormat('pt-BR').format(date);
  };

  // Função para mudar a página
  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  // Função para alterar a categoria selecionada
  const handleCategoryChange = (event) => {
    const newCategory = event.target.value;
    setSelectedCategory(newCategory);
  };

  // Função para alterar o período
  const handlePeriodChange = (event) => {
    const period = event.target.value;
    setSelectedPeriod(period);
    
    // Salvar o período selecionado no localStorage
    localStorage.setItem('selectedPeriod', period);
  };

  // Obter transações para a página atual
  const getCurrentTransactions = () => {
    const startIndex = (currentPage - 1) * transactionsPerPage;
    const endIndex = startIndex + transactionsPerPage;
    return transactions.slice(startIndex, endIndex);
  };

  if (loading && (!selectedPeriod || categories.length === 0)) {
    return (
      <MainLayout>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Carregando dados...</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout userName={user?.displayName || "Usuário"}>
      <div className="category-details-container">
        <div className="category-details-header">
          <h1>Detalhes por Categoria</h1>
          
          <div className="period-selector">
            <label htmlFor="period-select">Período:</label>
            <select
              id="period-select"
              value={selectedPeriod}
              onChange={handlePeriodChange}
              disabled={loading}
            >
              {periods.length === 0 ? (
                <option value="">Nenhum período disponível</option>
              ) : (
                periods.map((period) => (
                  <option key={period.value} value={period.value}>
                    {period.label}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
        
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
        
        <div className="category-filters">
          <div className="category-selector">
            <label htmlFor="category-select">Categoria:</label>
            <select
              id="category-select"
              value={selectedCategory}
              onChange={handleCategoryChange}
              disabled={loading}
            >
              {categories.length === 0 ? (
                <option value="">Nenhuma categoria disponível</option>
              ) : (
                categories.map((category) => (
                  <option key={category.fullPath} value={category.fullPath}>
                    {category.displayName}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
        
        <div className="category-details-summary">
          <div className="summary-card">
            <h3>Total da Categoria</h3>
            <div className={`summary-value ${totalAmount >= 0 ? "value-positive" : "value-negative"}`}>
              {formatCurrency(totalAmount)}
            </div>
          </div>
          
          <div className="summary-card">
            <h3>Número de Transações</h3>
            <div className="summary-value">
              {transactions.length}
            </div>
          </div>
        </div>
        
        {loading ? (
          <div className="loading-data">
            <div className="loading-spinner"></div>
            <p>Carregando transações...</p>
          </div>
        ) : (
          <>
            {transactions.length > 0 ? (
              <div className="transactions-content">
                <div className="transactions-table-container">
                  <table className="transactions-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Descrição</th>
                        <th>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getCurrentTransactions().map((transaction) => (
                        <tr key={transaction.id}>
                          <td>{formatDate(transaction.date)}</td>
                          <td className="description-cell">
                            {transaction.description}
                          </td>
                          <td className={transaction.amount >= 0 ? "amount-positive" : "amount-negative"}>
                            {formatCurrency(transaction.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* Paginação */}
                {totalPages > 1 && (
                  <div className="pagination">
                    <button
                      onClick={() => handlePageChange(1)}
                      disabled={currentPage === 1}
                      className="pagination-button"
                    >
                      &laquo;
                    </button>
                    
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="pagination-button"
                    >
                      &lt;
                    </button>
                    
                    <span className="pagination-info">
                      Página {currentPage} de {totalPages}
                    </span>
                    
                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="pagination-button"
                    >
                      &gt;
                    </button>
                    
                    <button
                      onClick={() => handlePageChange(totalPages)}
                      disabled={currentPage === totalPages}
                      className="pagination-button"
                    >
                      &raquo;
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="no-transactions">
                <p>Nenhuma transação encontrada para esta categoria no período selecionado.</p>
              </div>
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
};

export default CategoryDetails;