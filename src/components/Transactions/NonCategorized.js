// src/components/Transactions/NonCategorized.js
import React, { useState, useEffect } from "react";
import { auth, db, storage } from "../../firebase/config";
import { collection, query, where, getDocs, doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref, getBlob } from "firebase/storage";
import { parseOFXContent } from "../../utils/OFXParser";
import MainLayout from "../Layout/MainLayout";
import TransactionItem from "./TransactionItem";
import "./Transactions.css";

const NonCategorized = () => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [categories, setCategories] = useState({});
  const [isCategorizing, setIsCategorizing] = useState(true);
  const [categoryMappings, setCategoryMappings] = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterValue, setFilterValue] = useState("all"); // "all", "positive", "negative"
  const [autoMappedTransactions, setAutoMappedTransactions] = useState([]);
  const [filteredTransactions, setFilteredTransactions] = useState([]);
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
          const categoriesByGroup = {};
          
          Object.keys(categoriesData.categories).forEach(path => {
            if (categoriesData.categories[path]) {
              const parts = path.split('.');
              if (parts.length === 2) {
                const group = parts[0];
                const item = parts[1];
                
                if (!categoriesByGroup[group]) {
                  categoriesByGroup[group] = {
                    items: []
                  };
                }
                
                categoriesByGroup[group].items.push(item);
              }
            }
          });
          
          setCategories(categoriesByGroup);
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

  // Efeito para carregar transações quando mudar período
  useEffect(() => {
    if (selectedPeriod) {
      loadNonCategorizedTransactions();
    }
  }, [selectedPeriod, categoryMappings]);

  // Verificar se existe alguma categorização automática que precisa ser salva
  useEffect(() => {
    if (autoMappedTransactions.length > 0) {
      // Verificar se as transações já não foram salvas anteriormente
      const unsavedTransactions = autoMappedTransactions.filter(transaction => {
        // Verificar se não existe um mapeamento para esta transação
        return !Object.values(categoryMappings).some(mapping => 
          mapping.isSpecificMapping && 
          mapping.transactionId === transaction.id && 
          mapping.autoMapped === true
        );
      });
      
      if (unsavedTransactions.length > 0) {
        // Só exibir o aviso e salvar se realmente houver transações não salvas
        setAutoMappedTransactions(unsavedTransactions);
        saveAutoMappedTransactions();
      } else {
        // Limpar o array se todas as transações já estiverem salvas
        setAutoMappedTransactions([]);
      }
    }
  }, [autoMappedTransactions, categoryMappings]);

  // Efeito para filtrar transações quando mudar a busca ou filtro
  useEffect(() => {
    if (transactions.length > 0) {
      filterTransactions();
    }
  }, [transactions, searchTerm, filterValue]);

  // Função para filtrar transações
  const filterTransactions = () => {
    let filtered = [...transactions];
    
    // Aplicar filtro de busca por texto
    if (searchTerm) {
      filtered = filtered.filter(transaction => 
        transaction.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Aplicar filtro de valores positivos/negativos
    if (filterValue !== "all") {
      filtered = filtered.filter(transaction => {
        if (filterValue === "positive") {
          return transaction.amount >= 0;
        } else if (filterValue === "negative") {
          return transaction.amount < 0;
        }
        return true;
      });
    }
    
    setFilteredTransactions(filtered);
    
    // Resetar página atual e calcular total de páginas
    setCurrentPage(1);
    setTotalPages(Math.max(1, Math.ceil(filtered.length / transactionsPerPage)));
  };

  // Salvar categorizações automáticas no Firestore
  const saveAutoMappedTransactions = async () => {
    try {
      if (!auth.currentUser || autoMappedTransactions.length === 0) return;
      
      console.log("Salvando categorizações automáticas:", autoMappedTransactions.length);
      
      // Atualizar o mapeamento de categorias
      const updatedMappings = { ...categoryMappings };
      
      autoMappedTransactions.forEach(transaction => {
        const normalizedDescription = transaction.description.trim().toLowerCase();
        
        // Criar mapeamento específico para o ID desta transação
        const uniqueKey = `${normalizedDescription}_${transaction.id}`;
        
        updatedMappings[uniqueKey] = {
          categoryName: transaction.category,
          categoryPath: transaction.categoryPath,
          groupName: transaction.groupName || transaction.categoryPath.split('.')[0],
          lastUsed: new Date(),
          originalDescription: normalizedDescription,
          isSpecificMapping: true,
          transactionId: transaction.id,
          autoMapped: true
        };
      });
      
      // Salvar no Firestore
      const categoryMappingsRef = doc(db, "categoryMappings", auth.currentUser.uid);
      await updateDoc(categoryMappingsRef, {
        mappings: updatedMappings,
        updatedAt: serverTimestamp()
      });
      
      // Atualizar estado local
      setCategoryMappings(updatedMappings);
      
      // Limpar lista de transações automáticas pendentes
      setAutoMappedTransactions([]);
      
      // Recarregar lista de transações
      await loadNonCategorizedTransactions();
      
      setSuccess(`${autoMappedTransactions.length} transações categorizadas automaticamente e salvas.`);
      setTimeout(() => setSuccess(""), 3000);
      
    } catch (error) {
      console.error("Erro ao salvar categorizações automáticas:", error);
      setError("Não foi possível salvar as categorizações automáticas.");
    }
  };

  // Carregar transações não categorizadas
  const loadNonCategorizedTransactions = async () => {
    try {
      setLoading(true);
      
      if (!auth.currentUser || !selectedPeriod) return;
      
      // Buscar arquivos OFX do período selecionado
      const ofxFilesQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", auth.currentUser.uid),
        where("period", "==", selectedPeriod)
      );
      
      const ofxFilesSnapshot = await getDocs(ofxFilesQuery);
      const nonCategorizedTransactions = [];
      const autoMappedToSave = [];
      
      // Identificar mapeamentos específicos por ID de transação
      const specificMappings = {};
      
      // Primeiro, identificamos todos os mapeamentos específicos (para transações únicas)
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
            
            // Filtrar transações não categorizadas
            transactions.forEach(transaction => {
              const normalizedDescription = transaction.description.trim().toLowerCase();
              let isCategorized = false;
              
              // Verificar se tem mapeamento específico por ID
              if (specificMappings[transaction.id]) {
                isCategorized = true;
              } 
              // Verificar se tem mapeamento por descrição
              else if (categoryMappings[normalizedDescription]) {
                const mapping = categoryMappings[normalizedDescription];
                // Verificar se não é um mapeamento específico para outra transação
                if (!mapping.isSpecificMapping) {
                  isCategorized = true;
                }
              }
              // Verificar se foi categorizada automaticamente durante o parsing
              else if (transaction.autoMapped && transaction.category && transaction.categoryPath) {
                // Verificar se já existe um mapeamento específico para esta transação no Firestore
                const hasExistingMapping = Object.values(categoryMappings).some(mapping => 
                  mapping.isSpecificMapping && 
                  mapping.transactionId === transaction.id && 
                  mapping.autoMapped === true
                );
                
                // Apenas adicionar à lista de autoMappedToSave se ainda não existir mapeamento
                if (!hasExistingMapping) {
                  // Esta transação foi categorizada automaticamente, mas não está salva
                  autoMappedToSave.push({
                    ...transaction,
                    id: transaction.id,
                    description: transaction.description,
                    groupName: transaction.categoryPath.split('.')[0]
                  });
                }
                
                // A transação está categorizada, mesmo que ainda não esteja salva
                isCategorized = true;
              }
              
              // Se não está categorizada, adicionar à lista de não categorizados
              if (!isCategorized) {
                nonCategorizedTransactions.push({
                  ...transaction,
                  fileId: fileDoc.id,
                  fileName: fileData.fileName,
                  period: fileData.period,
                  periodLabel: fileData.periodLabel
                });
              }
            });
          } catch (error) {
            console.error(`Erro ao processar arquivo OFX ${fileData.fileName}:`, error);
          }
        }
      }
      
      // Se houver transações categorizadas automaticamente, mas não salvas, atualizarmos o estado
      if (autoMappedToSave.length > 0) {
        console.log(`Encontradas ${autoMappedToSave.length} transações com categorização automática não salva.`);
        setAutoMappedTransactions(autoMappedToSave);
      } else {
        // Limpar o estado para não mostrar a mensagem
        setAutoMappedTransactions([]);
      }
      
      // Ordenar transações por data (mais recente primeiro)
      nonCategorizedTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      setTransactions(nonCategorizedTransactions);
      setFilteredTransactions(nonCategorizedTransactions);
      
      // Calcular total de páginas
      setTotalPages(Math.max(1, Math.ceil(nonCategorizedTransactions.length / transactionsPerPage)));
      setCurrentPage(1); // Resetar para a primeira página
    } catch (error) {
      console.error("Erro ao carregar transações não categorizadas:", error);
      setError("Não foi possível carregar as transações não categorizadas.");
    } finally {
      setLoading(false);
    }
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
    return filteredTransactions.slice(startIndex, endIndex);
  };

  // Função para mudar a página
  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  // Função para categorizar uma transação (apenas localmente)
  const handleCategoryChange = (transactionId, group, item, categoryPath) => {
    try {
      setError("");
      
      // Encontrar a transação
      const transaction = transactions.find(t => t.id === transactionId);
      if (!transaction) return;
      
      // Atualizar a transação na interface (apenas localmente)
      setTransactions(prevTransactions => 
        prevTransactions.map(t => {
          if (t.id === transactionId) {
            return {
              ...t,
              category: item,
              categoryPath: categoryPath,
              groupName: group,
              modified: true,
              pendingSave: true
            };
          }
          return t;
        })
      );
      
      // Exibir mensagem para lembrar o usuário de salvar
      setSuccess(`Transação "${transaction.description}" categorizada. Não esqueça de salvar todas as alterações!`);
      
      // Limpar mensagem após 3 segundos
      setTimeout(() => {
        setSuccess("");
      }, 3000);
      
    } catch (error) {
      console.error("Erro ao categorizar transação:", error);
      setError("Não foi possível categorizar a transação. Tente novamente.");
    }
  };

  // Salvar todas as categorizações de uma vez
  const saveAllMappings = async () => {
    try {
      setLoading(true);
      setError("");
      
      const pendingTransactions = transactions.filter(t => t.pendingSave);
      if (pendingTransactions.length === 0) {
        setError("Nenhuma transação pendente para salvar.");
        setLoading(false);
        return;
      }
      
      // Atualizar o mapeamento de categorias
      const updatedMappings = { ...categoryMappings };
      
      pendingTransactions.forEach(transaction => {
        const normalizedDescription = transaction.description.trim().toLowerCase();
        
        if (transaction.categoryPath) {
          updatedMappings[normalizedDescription] = {
            categoryName: transaction.category,
            categoryPath: transaction.categoryPath,
            groupName: transaction.groupName,
            lastUsed: new Date()
          };
        }
      });
      
      // Salvar no Firestore
      const categoryMappingsRef = doc(db, "categoryMappings", auth.currentUser.uid);
      await updateDoc(categoryMappingsRef, {
        mappings: updatedMappings,
        updatedAt: serverTimestamp()
      });
      
      // Atualizar o estado local
      setCategoryMappings(updatedMappings);
      
      // Remover o estado de pendente das transações
      setTransactions(prevTransactions => 
        prevTransactions.map(t => ({
          ...t,
          pendingSave: false
        }))
      );
      
      // Recarregar transações
      await loadNonCategorizedTransactions();
      
      // Exibir mensagem de sucesso
      setSuccess(`${pendingTransactions.length} transações categorizadas e salvas com sucesso!`);
      
      // Limpar mensagem após 3 segundos
      setTimeout(() => {
        setSuccess("");
      }, 3000);
      
    } catch (error) {
      console.error("Erro ao salvar mapeamentos:", error);
      setError("Não foi possível salvar os mapeamentos. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  if (loading && (!selectedPeriod || Object.keys(categories).length === 0)) {
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
      <div className="non-categorized-container">
        {/* Novo seletor de período no padrão do Dashboard */}
        <div className="period-selector-container">
          <div className="period-selector-header">
            <h2>Transações Não Categorizadas</h2>
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
        
        {success && (
          <div className="success-message">
            {success}
          </div>
        )}
        
        {autoMappedTransactions.length > 0 && (
          <div className="info-message">
            <p>
              {autoMappedTransactions.length} transações foram categorizadas automaticamente e estão sendo salvas...
            </p>
          </div>
        )}
        
        {/* Nova barra de pesquisa com filtro por valores positivos/negativos */}
        <div className="transactions-filters">
          <div className="search-filter">
            <input
              type="text"
              placeholder="Buscar por descrição..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="filter-input"
            />
            
            <select
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              className="filter-select"
            >
              <option value="all">Todos os valores</option>
              <option value="positive">Valores positivos</option>
              <option value="negative">Valores negativos</option>
            </select>
          </div>
          
          <div className="transactions-count">
            {filteredTransactions.length} transações não categorizadas encontradas
          </div>
        </div>
        
        {loading ? (
          <div className="loading-data">
            <div className="loading-spinner"></div>
            <p>Carregando transações...</p>
          </div>
        ) : (
          <>
            {filteredTransactions.length > 0 ? (
              <div className="transactions-content">
                <div className="transactions-list">
                  {getCurrentTransactions().map((transaction) => (
                    <TransactionItem
                      key={transaction.id}
                      transaction={transaction}
                      categories={categories}
                      onCategoryChange={handleCategoryChange}
                      isCategorizing={isCategorizing}
                    />
                  ))}
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
                
                {/* Botão para salvar todos os mapeamentos */}
                <div className="save-mappings">
                  <button
                    className="save-all-button"
                    onClick={saveAllMappings}
                    disabled={loading || !transactions.some(t => t.pendingSave)}
                  >
                    {loading ? "Salvando..." : "Salvar Todas as Categorizações"}
                  </button>
                  
                  {transactions.some(t => t.pendingSave) && (
                    <div className="pending-changes-notification">
                      Existem alterações não salvas! Clique em "Salvar Todas as Categorizações" para confirmar.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="no-transactions">
                <p>Não existem transações não categorizadas para este período.</p>
              </div>
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
};

export default NonCategorized;