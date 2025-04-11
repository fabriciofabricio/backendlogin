// src/components/Transactions/TransactionList.js
import React, { useState, useEffect } from "react";
import { auth, db } from "../../firebase/config";
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  updateDoc
} from "firebase/firestore";
import TransactionItem from "./TransactionItem";

const TransactionList = ({ transactions, fileId, categories, onComplete }) => {
  const [processedTransactions, setProcessedTransactions] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [categoryMappings, setCategoryMappings] = useState({});
  const [saving, setSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isCategorizing, setIsCategorizing] = useState(true);
  const [period, setPeriod] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [existingTransactions, setExistingTransactions] = useState({});
  const transactionsPerPage = 10;

  // Calculate pagination
  const indexOfLastTransaction = currentPage * transactionsPerPage;
  const indexOfFirstTransaction = indexOfLastTransaction - transactionsPerPage;
  const totalPages = Math.ceil(processedTransactions.length / transactionsPerPage);

  // Extrair informações de período do primeiro item de transações
  useEffect(() => {
    if (transactions && transactions.length > 0) {
      const firstTransaction = transactions[0];
      if (firstTransaction.period) {
        setPeriod(firstTransaction.period);
      }
      if (firstTransaction.periodLabel) {
        setPeriodLabel(firstTransaction.periodLabel);
      }
    }
  }, [transactions]);

  // Load category mappings when component mounts
  useEffect(() => {
    const loadCategoryMappings = async () => {
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) return;

        // Get the category mappings document for the user
        const mappingsDocRef = doc(db, "categoryMappings", currentUser.uid);
        const mappingsDoc = await getDoc(mappingsDocRef);

        if (mappingsDoc.exists() && mappingsDoc.data().mappings) {
          setCategoryMappings(mappingsDoc.data().mappings);
        }
      } catch (error) {
        console.error("Error loading category mappings:", error);
      }
    };

    loadCategoryMappings();
  }, []);

  // Carregar transações existentes para verificação
  useEffect(() => {
    const loadExistingTransactions = async () => {
      try {
        const currentUser = auth.currentUser;
        if (!currentUser || !fileId) return;

        const existingTransQuery = query(
          collection(db, "transactions"),
          where("userId", "==", currentUser.uid),
          where("fileId", "==", fileId)
        );

        const snapshot = await getDocs(existingTransQuery);
        const existingTrans = {};

        snapshot.forEach(doc => {
          const data = doc.data();
          if (data.transactionId) {
            existingTrans[data.transactionId] = {
              docId: doc.id,
              ...data
            };
          }
        });

        setExistingTransactions(existingTrans);
      } catch (error) {
        console.error("Error loading existing transactions:", error);
      }
    };

    loadExistingTransactions();
  }, [fileId]);

  // Process transactions when they change or when mappings are loaded
  useEffect(() => {
    if (transactions && transactions.length > 0) {
      // Apply existing category mappings to new transactions
      const processed = transactions.map(transaction => {
        const normalizedDescription = transaction.description.trim().toLowerCase();
        
        // Verificar se já existe uma transação salva no Firestore
        const existingTrans = existingTransactions[transaction.id];
        
        if (existingTrans && existingTrans.categoryPath) {
          // Se já existe e tem categoria, usar os dados existentes
          return {
            ...transaction,
            category: existingTrans.category,
            categoryPath: existingTrans.categoryPath,
            groupName: existingTrans.groupName,
            existingDocId: existingTrans.docId,
            alreadySaved: true
          };
        } else if (categoryMappings[normalizedDescription]) {
          // Check if we have a mapping for this description
          const mapping = categoryMappings[normalizedDescription];
          return {
            ...transaction,
            category: mapping.categoryName,
            categoryPath: mapping.categoryPath,
            groupName: mapping.groupName,
            autoMapped: true,
            existingDocId: existingTrans?.docId
          };
        }
        
        return {
          ...transaction,
          existingDocId: existingTrans?.docId
        };
      });
      
      setProcessedTransactions(processed);
    } else {
      setProcessedTransactions(transactions || []);
    }
  }, [transactions, categoryMappings, existingTransactions]);

  // Filter and search transactions
  const filteredTransactions = processedTransactions.filter(transaction => {
    const matchesSearch = !searchTerm || 
      transaction.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = !filterCategory || 
      (transaction.categoryPath && transaction.categoryPath.startsWith(filterCategory));
    
    return matchesSearch && matchesCategory;
  });

  // Get current transactions for the page
  const currentTransactions = filteredTransactions.slice(
    indexOfFirstTransaction, 
    indexOfLastTransaction
  );

  // Handle category change for a transaction
  const handleCategoryChange = (transactionId, group, item, categoryPath) => {
    setProcessedTransactions(prevTransactions => 
      prevTransactions.map(transaction => {
        if (transaction.id === transactionId) {
          return {
            ...transaction,
            category: item,
            categoryPath: categoryPath,
            groupName: group,
            modified: true
          };
        }
        return transaction;
      })
    );
  };

  // Save category mappings only
  const saveTransactions = async () => {
    try {
      setSaving(true);
      setIsCategorizing(false);
      
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Usuário não autenticado");
      
      // Novo objeto para armazenar os mapeamentos
      const newMappings = { ...categoryMappings };
      const categorizedCount = 0;
      
      // Process each transaction to extract mappings
      for (const transaction of processedTransactions) {
        // Only process transactions that have been categorized
        if (transaction.categoryPath) {
          // Add to mappings if not already present
          const normalizedDescription = transaction.description.trim().toLowerCase();
          if (!newMappings[normalizedDescription]) {
            newMappings[normalizedDescription] = {
              categoryName: transaction.category,
              categoryPath: transaction.categoryPath,
              groupName: transaction.groupName || transaction.categoryPath.split('.')[0],
              lastUsed: new Date()
            };
          }
        }
      }
      
      // Salvar apenas o mapeamento de categorias no documento do usuário
      const categoryMappingsRef = doc(db, "categoryMappings", currentUser.uid);
      
      // Verificar se o documento já existe
      const categoryMappingsDoc = await getDoc(categoryMappingsRef);
      
      if (categoryMappingsDoc.exists()) {
        // Atualizar o documento existente
        await updateDoc(categoryMappingsRef, {
          mappings: newMappings,
          updatedAt: serverTimestamp()
        });
      } else {
        // Criar um novo documento
        await setDoc(categoryMappingsRef, {
          userId: currentUser.uid,
          mappings: newMappings,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp()
        });
      }
      
      const mappingsCount = Object.keys(newMappings).length;
      console.log("Mapeamentos de categorias salvos com sucesso:", mappingsCount);
      
      // Atualizar o documento do arquivo de OFX com informações sobre a categorização
      await updateDoc(doc(db, "ofxFiles", fileId), {
        lastMappingUpdate: serverTimestamp(),
        mappingsCount: mappingsCount
      });
      
      // Call the onComplete callback to notify parent component
      if (onComplete) {
        onComplete(mappingsCount);
      }
      
    } catch (error) {
      console.error("Error saving category mappings:", error);
      alert(`Erro ao salvar mapeamentos: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Get unique categories for filter
  const uniqueCategories = [...new Set(
    processedTransactions
      .filter(t => t.categoryPath)
      .map(t => t.categoryPath.split('.')[0])
  )];

  return (
    <div className="transactions-container">
      <div className="transactions-header">
        <h3>
          Categorizar Transações
          {periodLabel && <span style={{ fontWeight: 'normal', marginLeft: '10px', fontSize: '14px' }}>
            ({periodLabel})
          </span>}
        </h3>
        <div className="transactions-count">
          {processedTransactions.length} transações encontradas
        </div>
      </div>
      
      {processedTransactions.length > 0 ? (
        <>
          <div className="transaction-filters">
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
          
          <div className="transactions-list">
            {currentTransactions.map((transaction) => (
              <TransactionItem
                key={transaction.id}
                transaction={transaction}
                categories={categories}
                onCategoryChange={handleCategoryChange}
                isCategorizing={isCategorizing}
              />
            ))}
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="pagination-button"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
              >
                &laquo;
              </button>
              
              <button
                className="pagination-button"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                &lt;
              </button>
              
              <span className="pagination-info" style={{ margin: '0 10px' }}>
                Página {currentPage} de {totalPages}
              </span>
              
              <button
                className="pagination-button"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                &gt;
              </button>
              
              <button
                className="pagination-button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
              >
                &raquo;
              </button>
            </div>
          )}
          
          <button
            className="save-all-button"
            onClick={saveTransactions}
            disabled={saving || !isCategorizing}
          >
            {saving ? "Salvando..." : "Salvar Mapeamentos de Categorias"}
          </button>
        </>
      ) : (
        <div className="transactions-empty">
          Nenhuma transação encontrada. Importe um arquivo OFX para começar.
        </div>
      )}
    </div>
  );
};

export default TransactionList;