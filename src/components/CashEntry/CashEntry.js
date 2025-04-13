// src/components/CashEntry/CashEntry.js
import React, { useState, useEffect } from "react";
import { auth, db } from "../../firebase/config";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  orderBy,
  getDoc,
  limit // Adicionado o import de limit
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import MainLayout from "../Layout/MainLayout";
import "./CashEntry.css";

const CashEntry = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingEntry, setSavingEntry] = useState(false);
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  // Debug State
  const [debugInfo, setDebugInfo] = useState("");
  
  // Form states
  const [isEditing, setIsEditing] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Date constraints
  const [dateRange, setDateRange] = useState({ 
    min: "", 
    max: "",
    year: "",
    month: ""
  });
  
  // Confirmation modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState(null);

  // Verify auth state and ensure it's consistent
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        console.log("User authenticated:", currentUser.uid);
        setUser(currentUser);
        checkUserHasCollection(currentUser.uid);
        loadPeriods(currentUser);
      } else {
        console.log("No authenticated user");
        setUser(null);
        setError("Você precisa estar autenticado para acessar esta página.");
      }
      setLoading(false);
    });
    
    return () => unsubscribe();
  }, []);

  // Check if user collection exists
  const checkUserHasCollection = async (userId) => {
    try {
      // Check if the user has documents in the cashEntries collection
      const testQuery = query(
        collection(db, "cashEntries"),
        where("userId", "==", userId),
        limit(1)
      );
      
      await getDocs(testQuery); // Just testing if we can access this
      setDebugInfo("Permissão de leitura na coleção cashEntries: OK");
    } catch (error) {
      console.error("Erro ao verificar permissões:", error);
      setDebugInfo(`Erro de permissão: ${error.message}`);
      
      // Try to create a test document to see if writing is allowed
      try {
        const testDoc = await addDoc(collection(db, "userTest"), {
          userId,
          test: true,
          timestamp: serverTimestamp()
        });
        
        // If we get here, we can write but not read from cashEntries
        setDebugInfo("Permissão de escrita: OK, mas não há permissão de leitura em cashEntries");
        
        // Clean up test document
        await deleteDoc(doc(db, "userTest", testDoc.id));
      } catch (writeError) {
        console.error("Erro ao testar permissão de escrita:", writeError);
        setDebugInfo(`Sem permissão de leitura nem escrita: ${writeError.message}`);
      }
    }
  };

  // Load available periods
  const loadPeriods = async (currentUser) => {
    try {
      if (!currentUser) return;
      
      console.log("Loading periods for user:", currentUser.uid);
      
      const periodsQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", currentUser.uid)
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
      
      // If no periods found, create a default one
      if (uniquePeriods.length === 0) {
        const currentDate = new Date();
        const year = currentDate.getFullYear();
        const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
        
        const defaultPeriod = {
          value: `${year}-${month}`,
          label: `${getMonthName(month)} de ${year}`
        };
        
        uniquePeriods.push(defaultPeriod);
        console.log("Created default period:", defaultPeriod);
      }
      
      // Sort periods (most recent first)
      uniquePeriods.sort((a, b) => b.value.localeCompare(a.value));
      setPeriods(uniquePeriods);
      
      // Check for saved period in localStorage
      let savedPeriod = localStorage.getItem('selectedPeriod');
      let periodToUse;
      let periodLabelToUse;
      
      if (savedPeriod && uniquePeriods.find(p => p.value === savedPeriod)) {
        periodToUse = savedPeriod;
        const savedPeriodObj = uniquePeriods.find(p => p.value === savedPeriod);
        periodLabelToUse = savedPeriodObj.label;
      } else if (uniquePeriods.length > 0) {
        periodToUse = uniquePeriods[0].value;
        periodLabelToUse = uniquePeriods[0].label;
        localStorage.setItem('selectedPeriod', periodToUse);
      }
      
      if (periodToUse) {
        setSelectedPeriod(periodToUse);
        setPeriodLabel(periodLabelToUse);
        updateDateConstraints(periodToUse);
      }
    } catch (error) {
      console.error("Erro ao carregar períodos:", error);
      setError(`Não foi possível carregar os períodos: ${error.message}`);
      
      // Create a default period as fallback
      createDefaultPeriod();
    }
  };
  
  // Create a default period if none exists
  const createDefaultPeriod = () => {
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
    
    const defaultPeriod = {
      value: `${year}-${month}`,
      label: `${getMonthName(month)} de ${year}`
    };
    
    setPeriods([defaultPeriod]);
    setSelectedPeriod(defaultPeriod.value);
    setPeriodLabel(defaultPeriod.label);
    updateDateConstraints(defaultPeriod.value);
    
    console.log("Set default period:", defaultPeriod);
  };
  
  // Get month name from number
  const getMonthName = (monthNum) => {
    const months = [
      "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
    ];
    return months[parseInt(monthNum) - 1];
  };

  // Update date constraints when period changes
  const updateDateConstraints = (period) => {
    if (!period) return;
    
    const [year, month] = period.split("-");
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    
    const minDate = `${year}-${month}-01`;
    const maxDate = `${year}-${month}-${lastDay}`;
    
    setDateRange({
      min: minDate,
      max: maxDate,
      year,
      month
    });
    
    // Set default date to today if in range, otherwise first day of month
    const today = new Date().toISOString().split('T')[0];
    if (today >= minDate && today <= maxDate) {
      setEntryDate(today);
    } else {
      setEntryDate(minDate);
    }
  };

  // Load cash entries when period changes
  useEffect(() => {
    if (selectedPeriod && user) {
      loadCashEntries();
    }
  }, [selectedPeriod, user]);

  // Load cash entries for selected period
  const loadCashEntries = async () => {
    try {
      setLoading(true);
      
      if (!auth.currentUser || !selectedPeriod) {
        console.log("Cannot load entries: Missing user or period");
        return;
      }
      
      console.log("Loading entries for period:", selectedPeriod);
      
      // First, check if collection exists by getting a single document
      try {
        const testQuery = query(
          collection(db, "cashEntries"),
          where("userId", "==", auth.currentUser.uid),
          limit(1)
        );
        
        const testSnapshot = await getDocs(testQuery);
        
        // If collection doesn't exist or is empty, show empty state
        if (testSnapshot.empty) {
          console.log("No entries found, possibly new collection");
          setEntries([]);
          setLoading(false);
          return;
        }
      } catch (testError) {
        console.error("Error testing cashEntries collection:", testError);
        // If we get permission error, it might be because collection doesn't exist yet
        setEntries([]);
        setLoading(false);
        return;
      }
      
      const entriesQuery = query(
        collection(db, "cashEntries"),
        where("userId", "==", auth.currentUser.uid),
        where("period", "==", selectedPeriod),
        orderBy("transactionDate", "desc")
      );
      
      const entriesSnapshot = await getDocs(entriesQuery);
      const entriesList = [];
      
      entriesSnapshot.forEach(doc => {
        entriesList.push({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate() || new Date(),
          transactionDate: doc.data().transactionDate || doc.data().createdAt?.toDate().toISOString().split('T')[0]
        });
      });
      
      console.log(`Loaded ${entriesList.length} entries`);
      setEntries(entriesList);
    } catch (error) {
      console.error("Erro ao carregar entradas de dinheiro:", error);
      
      // More detailed error handling
      if (error.code === "permission-denied") {
        setError("Permissão negada ao acessar as entradas de dinheiro. Verifique as regras do Firestore.");
      } else {
        setError(`Erro ao carregar entradas: ${error.message}`);
      }
      
      // Set empty entries to avoid breaking UI
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  // Change period handler
  const handlePeriodChange = (event) => {
    const period = event.target.value;
    setSelectedPeriod(period);
    
    const selectedPeriodObj = periods.find(p => p.value === period);
    if (selectedPeriodObj) {
      setPeriodLabel(selectedPeriodObj.label);
    }
    
    localStorage.setItem('selectedPeriod', period);
    resetForm();
    updateDateConstraints(period);
  };

  // Reset form 
  const resetForm = () => {
    setAmount("");
    setDescription("");
    setIsEditing(false);
    setEditingEntryId(null);
    
    // Reset date to current date or first day of month if current date is outside range
    const today = new Date().toISOString().split('T')[0];
    if (today >= dateRange.min && today <= dateRange.max) {
      setEntryDate(today);
    } else {
      setEntryDate(dateRange.min);
    }
  };

  // Handle date input 
  const handleDateChange = (e) => {
    setEntryDate(e.target.value);
  };

  // Format date for display
  const formatDisplayDate = (dateString) => {
    if (!dateString) return "-";
    
    if (typeof dateString === 'string') {
      const [year, month, day] = dateString.split('-');
      return `${day}/${month}/${year}`;
    }
    
    return new Intl.DateTimeFormat('pt-BR').format(dateString);
  };

  // Format currency
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  // Submit form handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      setSavingEntry(true);
      
      if (!auth.currentUser) {
        throw new Error("Usuário não autenticado");
      }
      
      if (!selectedPeriod) {
        throw new Error("Selecione um período");
      }
      
      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        throw new Error("Digite um valor válido maior que zero");
      }
      
      if (!entryDate) {
        throw new Error("Selecione a data da entrada");
      }
      
      // Validate date is within period range
      if (entryDate < dateRange.min || entryDate > dateRange.max) {
        throw new Error(`A data deve estar dentro do período ${periodLabel}`);
      }
      
      const numericAmount = parseFloat(amount);
      const userId = auth.currentUser.uid;
      
      console.log("Saving entry:", { 
        amount: numericAmount,
        date: entryDate,
        period: selectedPeriod,
        userId
      });
      
      if (isEditing && editingEntryId) {
        // Check if document exists first
        const docRef = doc(db, "cashEntries", editingEntryId);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
          throw new Error("A entrada que você está tentando editar não existe mais.");
        }
        
        // Update existing entry
        await updateDoc(docRef, {
          amount: numericAmount,
          description: description.trim(),
          category: "Dinheiro",
          categoryPath: "RECEITA.Dinheiro",
          transactionDate: entryDate,
          updatedAt: serverTimestamp()
        });
        
        setSuccess("Entrada atualizada com sucesso!");
      } else {
        // Add new entry
        const entryData = {
          userId,
          period: selectedPeriod,
          periodLabel,
          amount: numericAmount,
          description: description.trim(),
          category: "Dinheiro",
          categoryPath: "RECEITA.Dinheiro",
          transactionDate: entryDate,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        
        await addDoc(collection(db, "cashEntries"), entryData);
        setSuccess("Entrada de dinheiro adicionada com sucesso!");
      }
      
      await loadCashEntries();
      resetForm();
      
      setTimeout(() => setSuccess(""), 3000);
    } catch (error) {
      console.error("Erro ao salvar entrada:", error);
      
      // Detailed error handling
      if (error.code === "permission-denied") {
        setError("Permissão negada ao salvar a entrada. Verifique as regras do Firestore.");
      } else {
        setError(error.message || "Não foi possível salvar a entrada de dinheiro.");
      }
      
      setTimeout(() => setError(""), 5000);
    } finally {
      setSavingEntry(false);
    }
  };

  // Edit entry handler
  const handleEditEntry = (entry) => {
    setAmount(entry.amount.toString());
    setDescription(entry.description || "");
    setEntryDate(entry.transactionDate || dateRange.min);
    setIsEditing(true);
    setEditingEntryId(entry.id);
    
    // Scroll to form
    document.querySelector('.cash-entry-form-card')?.scrollIntoView({ 
      behavior: 'smooth' 
    });
  };

  // Confirm delete handler
  const confirmDelete = (entry) => {
    setEntryToDelete(entry);
    setShowDeleteModal(true);
  };

  // Delete entry handler
  const handleDeleteEntry = async () => {
    if (!entryToDelete) return;
    
    try {
      setShowDeleteModal(false);
      setLoading(true);
      
      const docRef = doc(db, "cashEntries", entryToDelete.id);
      
      // Check if document exists first
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        throw new Error("A entrada que você está tentando excluir não existe mais.");
      }
      
      await deleteDoc(docRef);
      
      setSuccess("Entrada removida com sucesso!");
      await loadCashEntries();
      
      setTimeout(() => setSuccess(""), 3000);
    } catch (error) {
      console.error("Erro ao excluir entrada:", error);
      
      if (error.code === "permission-denied") {
        setError("Permissão negada ao excluir a entrada. Verifique as regras do Firestore.");
      } else {
        setError("Não foi possível excluir a entrada: " + error.message);
      }
      
      setTimeout(() => setError(""), 5000);
    } finally {
      setLoading(false);
      setEntryToDelete(null);
    }
  };

  // Calculate total
  const calculateTotal = () => {
    return entries.reduce((total, entry) => total + (entry.amount || 0), 0);
  };

  // Check if special period (Feb 2025)
  const isFebruary2025 = dateRange.year === "2025" && dateRange.month === "02";

  return (
    <MainLayout userName={user?.displayName || "Usuário"}>
      <div className="cash-entry-container">
        <div className="cash-entry-header">
          <h1>Entrada de Dinheiro</h1>
          
          <div className="period-selector">
            <label htmlFor="period-select">Período:</label>
            <select
              id="period-select"
              value={selectedPeriod}
              onChange={handlePeriodChange}
              disabled={loading || savingEntry}
              className="period-select"
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
          <div className="notification error-notification">
            <span className="notification-message">{error}</span>
            <button className="notification-close" onClick={() => setError("")}>×</button>
          </div>
        )}
        
        {success && (
          <div className="notification success-notification">
            <span className="notification-message">{success}</span>
            <button className="notification-close" onClick={() => setSuccess("")}>×</button>
          </div>
        )}
        
        {debugInfo && (
          <div className="notification debug-notification">
            <span className="notification-message">{debugInfo}</span>
            <button className="notification-close" onClick={() => setDebugInfo("")}>×</button>
          </div>
        )}
        
        {loading && !selectedPeriod ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>Carregando dados...</p>
          </div>
        ) : (
          <>
            {/* Cash Entry Form */}
            <div className="cash-entry-form-card">
              <h2>{isEditing ? "Editar Entrada de Dinheiro" : "Nova Entrada de Dinheiro"}</h2>
              
              <form onSubmit={handleSubmit} className="cash-entry-form">
                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="amount">
                      Valor (R$)<span className="required">*</span>
                    </label>
                    <input
                      type="number"
                      id="amount"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Ex: 100.00"
                      min="0.01"
                      step="0.01"
                      required
                      disabled={savingEntry}
                      className="form-input"
                    />
                  </div>
                  
                  <div className="form-field">
                    <label htmlFor="entry-date">
                      Data<span className="required">*</span>
                    </label>
                    {isFebruary2025 ? (
                      // Special handling for February 2025
                      <div className="date-input-container">
                        <select
                          id="day-select"
                          value={entryDate.split('-')[2]}
                          onChange={(e) => setEntryDate(`2025-02-${e.target.value}`)}
                          disabled={savingEntry}
                          className="day-only-select"
                        >
                          {Array.from({ length: 29 }, (_, i) => {
                            const day = (i + 1).toString().padStart(2, '0');
                            return (
                              <option key={day} value={day}>
                                {day}
                              </option>
                            );
                          })}
                        </select>
                        <span className="date-separator">/</span>
                        <div className="static-date-part">Fevereiro</div>
                        <span className="date-separator">/</span>
                        <div className="static-date-part">2025</div>
                      </div>
                    ) : (
                      <input
                        type="date"
                        id="entry-date"
                        value={entryDate}
                        onChange={handleDateChange}
                        min={dateRange.min}
                        max={dateRange.max}
                        required
                        disabled={savingEntry}
                        className="form-input date-input"
                      />
                    )}
                    <span className="input-help-text">
                      Período: {formatDisplayDate(dateRange.min)} a {formatDisplayDate(dateRange.max)}
                    </span>
                  </div>
                </div>
                
                <div className="form-field">
                  <label htmlFor="description">Descrição</label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrição opcional"
                    rows="2"
                    disabled={savingEntry}
                    className="form-input description-input"
                  ></textarea>
                </div>
                
                <div className="form-actions">
                  {isEditing && (
                    <button
                      type="button"
                      className="cancel-button"
                      onClick={resetForm}
                      disabled={savingEntry}
                    >
                      Cancelar
                    </button>
                  )}
                  
                  <button
                    type="submit"
                    className="submit-button"
                    disabled={savingEntry || !amount}
                  >
                    {savingEntry ? (
                      <>
                        <span className="button-spinner"></span>
                        <span>Salvando...</span>
                      </>
                    ) : (
                      isEditing ? "Atualizar Entrada" : "Adicionar Entrada"
                    )}
                  </button>
                </div>
              </form>
            </div>
            
            {/* Entries List */}
            <div className="entries-list-card">
              <div className="entries-header">
                <h2>Entradas em {periodLabel}</h2>
                <div className="entries-total">
                  <span className="total-label">Total:</span>
                  <span className="total-value">{formatCurrency(calculateTotal())}</span>
                </div>
              </div>
              
              {loading ? (
                <div className="loading-state">
                  <div className="loading-spinner"></div>
                  <p>Carregando entradas...</p>
                </div>
              ) : entries.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">💵</div>
                  <p className="empty-message">Nenhuma entrada de dinheiro registrada para este período.</p>
                  <p className="empty-help">Use o formulário acima para adicionar uma nova entrada.</p>
                </div>
              ) : (
                <div className="entries-table-container">
                  <table className="entries-table">
                    <thead>
                      <tr>
                        <th className="date-column">Data</th>
                        <th className="amount-column">Valor</th>
                        <th className="description-column">Descrição</th>
                        <th className="actions-column">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.id}>
                          <td>{formatDisplayDate(entry.transactionDate)}</td>
                          <td className="amount-cell">{formatCurrency(entry.amount)}</td>
                          <td className="description-cell">{entry.description || "-"}</td>
                          <td className="actions-cell">
                            <button
                              className="action-button edit-button"
                              onClick={() => handleEditEntry(entry)}
                              title="Editar"
                              disabled={savingEntry}
                            >
                              <span className="action-icon">✎</span>
                              <span className="action-text">Editar</span>
                            </button>
                            <button
                              className="action-button delete-button"
                              onClick={() => confirmDelete(entry)}
                              title="Excluir"
                              disabled={savingEntry}
                            >
                              <span className="action-icon">×</span>
                              <span className="action-text">Excluir</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
        
        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <div className="modal-overlay">
            <div className="modal-container">
              <div className="modal-header">
                <h3>Confirmar Exclusão</h3>
                <button 
                  className="modal-close"
                  onClick={() => setShowDeleteModal(false)}
                >
                  ×
                </button>
              </div>
              <div className="modal-content">
                <p className="modal-message">Tem certeza que deseja excluir esta entrada de dinheiro?</p>
                <div className="entry-details">
                  <div className="entry-detail">
                    <span className="detail-label">Valor:</span>
                    <span className="detail-value">{formatCurrency(entryToDelete?.amount || 0)}</span>
                  </div>
                  <div className="entry-detail">
                    <span className="detail-label">Data:</span>
                    <span className="detail-value">{formatDisplayDate(entryToDelete?.transactionDate)}</span>
                  </div>
                  {entryToDelete?.description && (
                    <div className="entry-detail">
                      <span className="detail-label">Descrição:</span>
                      <span className="detail-value">{entryToDelete.description}</span>
                    </div>
                  )}
                </div>
                <p className="warning-text">Esta ação não pode ser desfeita.</p>
              </div>
              <div className="modal-footer">
                <button
                  className="cancel-button"
                  onClick={() => setShowDeleteModal(false)}
                >
                  Cancelar
                </button>
                <button
                  className="delete-button"
                  onClick={handleDeleteEntry}
                >
                  Excluir Entrada
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default CashEntry;