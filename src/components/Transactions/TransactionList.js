// src/components/Transactions/TransactionList.js
import React, { useState, useEffect } from "react";
import { auth, db } from "../../firebase/config";
import { 
  collection, 
  addDoc, 
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

  // Process transactions when they change or when mappings are loaded
  useEffect(() => {
    if (transactions && transactions.length > 0) {
      // Apply existing category mappings to new transactions
      const processed = transactions.map(transaction => {
        const normalizedDescription = transaction.description.trim().toLowerCase();
        
        // Check if we have a mapping for this description
        if (categoryMappings[normalizedDescription]) {
          const mapping = categoryMappings[normalizedDescription];
          return {
            ...transaction,
            category: mapping.categoryName,
            categoryPath: mapping.categoryPath,
            autoMapped: true
          };
        }
        
        return transaction;
      });
      
      setProcessedTransactions(processed);
    } else {
      setProcessedTransactions(transactions || []);
    }
  }, [transactions, categoryMappings]);

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

  // Save all transactions and category mappings
  const saveTransactions = async () => {
    try {
      setSaving(true);
      setIsCategorizing(false);
      
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Usuário não autenticado");
      
      // Create a batch for all transactions
      const transactionsToSave = [];
      const newMappings = { ...categoryMappings };
      
      // Process each transaction
      for (const transaction of processedTransactions) {
        // Only save transactions that have been categorized
        if (transaction.categoryPath) {
          // Prepare transaction data for Firestore
          const transactionData = {
            userId: currentUser.uid,
            fileId: fileId,
            transactionId: transaction.id,
            date: new Date(transaction.date),
            amount: transaction.amount,
            description: transaction.description,
            category: transaction.category,
            categoryPath: transaction.categoryPath,
            groupName: transaction.groupName || transaction.categoryPath.split('.')[0],
            // Incluir período, mês e ano se disponíveis
            period: transaction.period || period,
            periodLabel: transaction.periodLabel || periodLabel,
            month: transaction.month || period?.split('-')[1],
            year: transaction.year || period?.split('-')[0],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          
          transactionsToSave.push(transactionData);
          
          // Add to mappings if not already present
          const normalizedDescription = transaction.description.trim().toLowerCase();
          if (!newMappings[normalizedDescription] && transaction.categoryPath) {
            newMappings[normalizedDescription] = {
              categoryName: transaction.category,
              categoryPath: transaction.categoryPath,
              groupName: transaction.groupName || transaction.categoryPath.split('.')[0],
              lastUsed: new Date()
            };
          }
        }
      }
      
      // Salvar o mapeamento de categorias primeiro
      await setDoc(doc(db, "categoryMappings", currentUser.uid), {
        userId: currentUser.uid,
        mappings: newMappings,
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      // Save all transactions to Firestore
      for (const transaction of transactionsToSave) {
        await addDoc(collection(db, "transactions"), transaction);
      }
      
      // Atualizar o documento do arquivo com a contagem de transações categorizadas
      await updateDoc(doc(db, "ofxFiles", fileId), {
        categorizedCount: transactionsToSave.length,
        lastCategorizedAt: serverTimestamp()
      });
      
      // Call the onComplete callback to notify parent component
      if (onComplete) {
        onComplete(transactionsToSave.length);
      }
      
    } catch (error) {
      console.error("Error saving transactions:", error);
      alert(`Erro ao salvar transações: ${error.message}`);
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
            {saving ? "Salvando..." : "Salvar Todas as Categorias"}
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