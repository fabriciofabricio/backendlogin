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
        
        // Process categories into a more usable format for the TransactionItem component
        if (categoriesData.categories) {
          // Extrair categorias selecionadas organizadas por grupo
          const flatCategories = [];
          
          Object.keys(categoriesData.categories).forEach(path => {
            if (categoriesData.categories[path]) {
              const parts = path.split('.');
              if (parts.length === 2) {
                const group = parts[0];
                const category = parts[1]; // Fixed: Define category variable
                
                flatCategories.push({
                  fullPath: path,
                  group,
                  category,  // Now correctly defined
                  displayName: category
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
      
      // 1. Buscar arquivos OFX do período selecionado
      const ofxFilesQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", auth.currentUser.uid),
        where("period", "==", selectedPeriod)
      );
      
      const ofxFilesSnapshot = await getDocs(ofxFilesQuery);
      const transactionsForCategory = [];
      let totalAmountForCategory = 0;
      
      // Identificar mapeamentos específicos por ID de transação
      const specificMappings = {};
      
      // Identificamos todos os mapeamentos específicos (para transações únicas)
      Object.entries(categoryMappings).forEach(([key, mapping]) => {
        if (mapping.isSpecificMapping && mapping.transactionId) {
          specificMappings[mapping.transactionId] = mapping;
        }
      });
      
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
              let isCategorized = false;
              let mapping = null;
              
              // Primeiro verificar se existe um mapeamento específico para esta transação
              if (specificMappings[transaction.id]) {
                mapping = specificMappings[transaction.id];
                
                // Verificar se a transação pertence à categoria e grupo selecionados
                if (mapping.groupName === selectedGroup && mapping.categoryName === selectedCategoryName) {
                  isCategorized = true;
                }
              } 
              // Se não existir mapeamento específico, verificar mapeamento normal
              else if (categoryMappings[normalizedDescription]) {
                mapping = categoryMappings[normalizedDescription];
                
                // Verificar se não é um mapeamento específico para outra transação
                if (!mapping.isSpecificMapping) {
                  // Verificar se pertence à categoria e grupo selecionados
                  if (mapping.groupName === selectedGroup && mapping.categoryName === selectedCategoryName) {
                    isCategorized = true;
                  }
                }
              }
              
              if (isCategorized) {
                transactionsForCategory.push({
                  ...transaction,
                  date: new Date(transaction.date),
                  fileId: fileDoc.id,
                  fileName: fileData.fileName,
                  source: 'ofx'
                });
                
                totalAmountForCategory += transaction.amount;
              }
            });
          } catch (error) {
            console.error(`Erro ao processar arquivo OFX ${fileData.fileName}:`, error);
          }
        }
      }
      
      // 2. NOVO: Buscar e processar entradas de dinheiro para o período e categoria
      try {
        const cashEntriesQuery = query(
          collection(db, "cashEntries"),
          where("userId", "==", auth.currentUser.uid),
          where("period", "==", selectedPeriod)
        );
        
        const cashEntriesSnapshot = await getDocs(cashEntriesQuery);
        
        // Processar cada entrada de dinheiro
        cashEntriesSnapshot.forEach(doc => {
          const entry = doc.data();
          
          // Verificar se a entrada tem categoria e valor
          if (entry.categoryPath && typeof entry.amount === 'number') {
            const pathParts = entry.categoryPath.split('.');
            
            if (pathParts.length >= 2) {
              const entryGroup = pathParts[0];
              const entryCategory = pathParts[1];
              
              // Verificar se a entrada corresponde à categoria selecionada
              if (entryGroup === selectedGroup && entryCategory === selectedCategoryName) {
                // Criar um objeto de transação com os dados da entrada de dinheiro
                const cashTransaction = {
                  id: doc.id,
                  date: entry.transactionDate ? new Date(entry.transactionDate) : entry.createdAt.toDate(),
                  description: entry.description || "Entrada de dinheiro",
                  amount: entry.amount,
                  category: selectedCategoryName,
                  categoryPath: entry.categoryPath,
                  groupName: entryGroup,
                  source: 'cash'
                };
                
                transactionsForCategory.push(cashTransaction);
                totalAmountForCategory += entry.amount;
                
                console.log(`Entrada de dinheiro encontrada para a categoria ${selectedCategoryName}: ${formatCurrency(entry.amount)}`);
              }
            }
          }
        });
      } catch (error) {
        console.error("Erro ao carregar entradas de dinheiro:", error);
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
        {/* Novo seletor de período no padrão do Dashboard */}
        <div className="period-selector-container">
          <div className="period-selector-header">
            <h2>Detalhes por Categoria</h2>
            <div className="period-dropdown">
              <label htmlFor="period-select">Período: </label>
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
                        <th>Fonte</th>
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
                          <td>
                            {transaction.source === 'cash' ? (
                              <span className="source-badge cash-source">Entrada Manual</span>
                            ) : (
                              <span className="source-badge ofx-source">Extrato</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* Paginação - ATUALIZADA com ícones SVG */}
                {totalPages > 1 && (
                  <div className="pagination">
                    <button
                      onClick={() => handlePageChange(1)}
                      disabled={currentPage === 1}
                      className="pagination-button"
                      title="Primeira página"
                      aria-label="Ir para a primeira página"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pagination-icon">
                        <polyline points="11 17 6 12 11 7"></polyline>
                        <polyline points="18 17 13 12 18 7"></polyline>
                      </svg>
                    </button>
                    
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="pagination-button"
                      title="Página anterior"
                      aria-label="Ir para a página anterior"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pagination-icon">
                        <polyline points="15 18 9 12 15 6"></polyline>
                      </svg>
                    </button>
                    
                    <span className="pagination-info">
                      Página {currentPage} de {totalPages}
                    </span>
                    
                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="pagination-button"
                      title="Próxima página"
                      aria-label="Ir para a próxima página"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pagination-icon">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </button>
                    
                    <button
                      onClick={() => handlePageChange(totalPages)}
                      disabled={currentPage === totalPages}
                      className="pagination-button"
                      title="Última página"
                      aria-label="Ir para a última página"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pagination-icon">
                        <polyline points="13 17 18 12 13 7"></polyline>
                        <polyline points="6 17 11 12 6 7"></polyline>
                      </svg>
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