// src/components/Transactions/EditCategorized.js
// Componente para editar itens já categorizados
import React, { useState, useEffect } from "react";
import { auth, db, storage } from "../../firebase/config";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc,
  updateDoc,
  serverTimestamp
} from "firebase/firestore";
import { ref, getBlob } from "firebase/storage";
import { parseOFXContent } from "../../utils/OFXParser";
import MainLayout from "../Layout/MainLayout";
import "./Transactions.css";

const EditCategorized = () => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [filteredTransactions, setFilteredTransactions] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [categories, setCategories] = useState({});
  const [flatCategories, setFlatCategories] = useState([]);
  const [categoryMappings, setCategoryMappings] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [newCategory, setNewCategory] = useState("");
  const [editScope, setEditScope] = useState("single"); // "single" ou "all"
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
        
        // Process categories into a more usable format
        if (categoriesData.categories) {
          // Extrair categorias selecionadas organizadas por grupo
          const categoriesByGroup = {};
          const flattenedCategories = [];
          
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
                
                // Adicionar ao array de categorias plano
                flattenedCategories.push({
                  label: item,
                  value: path,
                  group: group
                });
              }
            }
          });
          
          // Ordenar alfabeticamente
          flattenedCategories.sort((a, b) => a.label.localeCompare(b.label));
          
          setCategories(categoriesByGroup);
          setFlatCategories(flattenedCategories);
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
      loadCategorizedTransactions();
    }
  }, [selectedPeriod, categoryMappings]);

  // Efeito para filtrar transações quando mudar a busca ou filtro
  useEffect(() => {
    if (transactions.length > 0) {
      filterTransactions();
    }
  }, [transactions, searchTerm, filterCategory]);

  // Função para filtrar transações
  const filterTransactions = () => {
    let filtered = [...transactions];
    
    // Aplicar filtro de busca
    if (searchTerm) {
      filtered = filtered.filter(transaction => 
        transaction.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Aplicar filtro de categoria
    if (filterCategory) {
      filtered = filtered.filter(transaction => 
        transaction.categoryPath && transaction.categoryPath.startsWith(filterCategory)
      );
    }
    
    setFilteredTransactions(filtered);
    
    // Resetar página atual e calcular total de páginas
    setCurrentPage(1);
    setTotalPages(Math.max(1, Math.ceil(filtered.length / transactionsPerPage)));
  };

  // Carregar transações categorizadas
  const loadCategorizedTransactions = async () => {
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
      const categorizedTransactions = [];
      
      // Criar um mapa de IDs de transações para facilitar a busca
      const transactionIdMap = {};
      
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
            
            // Filtrar transações categorizadas
            transactions.forEach(transaction => {
              const normalizedDescription = transaction.description.trim().toLowerCase();
              
              // Primeiro verificar se existe um mapeamento específico para esta transação
              if (specificMappings[transaction.id]) {
                const specificMapping = specificMappings[transaction.id];
                
                categorizedTransactions.push({
                  ...transaction,
                  fileId: fileDoc.id,
                  fileName: fileData.fileName,
                  period: fileData.period,
                  periodLabel: fileData.periodLabel,
                  category: specificMapping.categoryName,
                  categoryPath: specificMapping.categoryPath,
                  groupName: specificMapping.groupName,
                  isSpecificMapping: true
                });
                
                // Marcar esta transação como processada
                transactionIdMap[transaction.id] = true;
              } 
              // Se não existir mapeamento específico, verificar mapeamento normal
              else if (categoryMappings[normalizedDescription]) {
                const mapping = categoryMappings[normalizedDescription];
                
                // Verificar se não é um mapeamento específico para outra transação
                if (!mapping.isSpecificMapping) {
                  categorizedTransactions.push({
                    ...transaction,
                    fileId: fileDoc.id,
                    fileName: fileData.fileName,
                    period: fileData.period,
                    periodLabel: fileData.periodLabel,
                    category: mapping.categoryName,
                    categoryPath: mapping.categoryPath,
                    groupName: mapping.groupName
                  });
                }
              }
            });
          } catch (error) {
            console.error(`Erro ao processar arquivo OFX ${fileData.fileName}:`, error);
          }
        }
      }
      
      // Ordenar transações por categoria e depois por data
      categorizedTransactions.sort((a, b) => {
        if (a.categoryPath !== b.categoryPath) {
          return a.categoryPath.localeCompare(b.categoryPath);
        }
        return new Date(b.date) - new Date(a.date);
      });
      
      setTransactions(categorizedTransactions);
      setFilteredTransactions(categorizedTransactions);
      
      // Calcular total de páginas
      setTotalPages(Math.max(1, Math.ceil(categorizedTransactions.length / transactionsPerPage)));
      setCurrentPage(1); // Resetar para a primeira página
    } catch (error) {
      console.error("Erro ao carregar transações categorizadas:", error);
      setError("Não foi possível carregar as transações categorizadas.");
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

  // Formatar data
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('pt-BR').format(date);
  };

  // Formatar valor monetário
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  // Abrir modal de edição
  const handleEditTransaction = (transaction) => {
    setEditingTransaction(transaction);
    setNewCategory(transaction.categoryPath);
    setEditScope("single");
  };

  // Fechar modal de edição
  const handleCloseEdit = () => {
    setEditingTransaction(null);
    setNewCategory("");
    setEditScope("single");
  };

  // Salvar edição de categoria
  const handleSaveEdit = async () => {
    try {
      setLoading(true);
      setError("");
      
      if (!editingTransaction || !newCategory) {
        setError("Selecione uma categoria válida.");
        setLoading(false);
        return;
      }
      
      const selectedCategoryObj = flatCategories.find(cat => cat.value === newCategory);
      if (!selectedCategoryObj) {
        setError("Categoria selecionada inválida.");
        setLoading(false);
        return;
      }
      
      const normalizedDescription = editingTransaction.description.trim().toLowerCase();
      const updatedMappings = { ...categoryMappings };
      
      if (editScope === "all") {
        // Atualizar mapeamento para todas as transações com a mesma descrição
        updatedMappings[normalizedDescription] = {
          categoryName: selectedCategoryObj.label,
          categoryPath: newCategory,
          groupName: selectedCategoryObj.group,
          lastUsed: new Date()
        };
        
        // Remover quaisquer mapeamentos específicos existentes para transações com essa descrição
        Object.keys(updatedMappings).forEach(key => {
          const mapping = updatedMappings[key];
          if (mapping.isSpecificMapping && mapping.originalDescription === normalizedDescription) {
            delete updatedMappings[key];
          }
        });
      } else {
        // Criar um novo mapeamento apenas para esta transação específica
        const uniqueKey = `${normalizedDescription}_${editingTransaction.id}`;
        
        updatedMappings[uniqueKey] = {
          categoryName: selectedCategoryObj.label,
          categoryPath: newCategory,
          groupName: selectedCategoryObj.group,
          lastUsed: new Date(),
          originalDescription: normalizedDescription,
          isSpecificMapping: true,
          transactionId: editingTransaction.id
        };
      }
      
      // Atualizar no Firestore
      const categoryMappingsRef = doc(db, "categoryMappings", auth.currentUser.uid);
      await updateDoc(categoryMappingsRef, {
        mappings: updatedMappings,
        updatedAt: serverTimestamp()
      });
      
      // Atualizar estado local
      setCategoryMappings(updatedMappings);
      
      if (editScope === "all") {
        setSuccess(`Todas as transações com a descrição "${editingTransaction.description}" foram atualizadas para a categoria "${selectedCategoryObj.label}".`);
      } else {
        setSuccess(`A transação "${editingTransaction.description}" (ID: ${editingTransaction.id}) foi atualizada para a categoria "${selectedCategoryObj.label}".`);
      }
      
      // Fechar modal e recarregar transações
      handleCloseEdit();
      await loadCategorizedTransactions();
      
      // Limpar mensagem de sucesso após 3 segundos
      setTimeout(() => {
        setSuccess("");
      }, 3000);
      
    } catch (error) {
      console.error("Erro ao atualizar categoria:", error);
      setError("Não foi possível atualizar a categoria. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  // Obter categorias únicas para o filtro
  const uniqueCategories = [...new Set(
    transactions
      .filter(t => t.groupName)
      .map(t => t.groupName)
  )];

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
      <div className="edit-categorized-container">
        {/* Novo seletor de período no padrão do Dashboard */}
        <div className="period-selector-container">
          <div className="period-selector-header">
            <h2>Editar Itens Categorizados</h2>
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
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="filter-select"
            >
              <option value="">Todas as categorias</option>
              {uniqueCategories.map((category, index) => (
                <option key={index} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          
          <div className="transactions-count">
            {filteredTransactions.length} transações categorizadas encontradas
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
                <div className="transactions-table-container">
                  <table className="transactions-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Descrição</th>
                        <th>Categoria</th>
                        <th>Valor</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getCurrentTransactions().map((transaction) => (
                        <tr key={transaction.id}>
                          <td>{formatDate(transaction.date)}</td>
                          <td className="description-cell">
                            {transaction.description}
                          </td>
                          <td>
                            <span className="category-badge">
                              {transaction.category}
                            </span>
                          </td>
                          <td className={transaction.amount >= 0 ? "amount-positive" : "amount-negative"}>
                            {formatCurrency(transaction.amount)}
                          </td>
                          <td>
                          <button
                          className="edit-category-button"
                          onClick={() => handleEditTransaction(transaction)}
                          aria-label="Editar categoria desta transação"
                        >
                          Editar Categoria
                        </button>
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
                <p>Não existem transações categorizadas para este período ou filtragem.</p>
              </div>
            )}
          </>
        )}
        
        {/* Modal de edição com estrutura aprimorada */}
        {editingTransaction && (
          <div className="edit-modal-overlay">
            <div className="edit-modal">
              <div className="edit-modal-header">
                <h3>Editar Categorização</h3>
                <button className="close-modal-button" onClick={handleCloseEdit}>×</button>
              </div>
              
              <div className="edit-modal-content">
                <div className="transaction-details">
                  <p>
                    <strong>Descrição:</strong>
                    {editingTransaction.description}
                  </p>
                  <p>
                    <strong>Data:</strong>
                    {formatDate(editingTransaction.date)}
                  </p>
                  <p>
                    <strong>Valor:</strong>
                    <span className={editingTransaction.amount >= 0 ? "amount-positive" : "amount-negative"}>
                      {formatCurrency(editingTransaction.amount)}
                    </span>
                  </p>
                  <p>
                    <strong>Categoria Atual:</strong>
                    <span className="category-badge">{editingTransaction.category}</span>
                  </p>
                </div>
                
                <div className="category-selection">
                  <label htmlFor="new-category-select">Nova Categoria:</label>
                  <select
                    id="new-category-select"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="category-select"
                  >
                    <option value="">Selecione uma categoria</option>
                    {flatCategories.map((category, index) => (
                      <option key={index} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="edit-scope-selection">
                  <p>Aplicar alteração:</p>
                  <div className="radio-group">
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="editScope"
                        value="single"
                        checked={editScope === "single"}
                        onChange={() => setEditScope("single")}
                      />
                      Apenas para esta transação
                    </label>
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="editScope"
                        value="all"
                        checked={editScope === "all"}
                        onChange={() => setEditScope("all")}
                      />
                      Para todas as transações com este nome
                    </label>
                  </div>
                </div>
              </div>
              
              <div className="edit-modal-footer">
                <button className="cancel-button" onClick={handleCloseEdit}>
                  Cancelar
                </button>
                <button 
                  className="save-button" 
                  onClick={handleSaveEdit}
                  disabled={!newCategory || loading}
                >
                  {loading ? "Salvando..." : "Salvar Alterações"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default EditCategorized;