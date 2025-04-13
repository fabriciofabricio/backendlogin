// src/components/CashEntry/CashEntry.js
import React, { useState, useEffect } from "react";
import { auth, db } from "../../firebase/config";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  orderBy
} from "firebase/firestore";
import MainLayout from "../Layout/MainLayout";
import "./CashEntry.css";

const CashEntry = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [minDate, setMinDate] = useState("");
  const [maxDate, setMaxDate] = useState("");
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  // Estados para o formulário
  const [isEditing, setIsEditing] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  
  // Estado para o modal de confirmação
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState(null);

  // Carregar dados iniciais: usuário e períodos
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        
        if (auth.currentUser) {
          setUser(auth.currentUser);
          await loadPeriods();
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

  // Definir datas mínima e máxima com base no período selecionado
  useEffect(() => {
    if (selectedPeriod) {
      // O período está no formato YYYY-MM
      const [year, month] = selectedPeriod.split("-");
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate(); // Último dia do mês
      
      setMinDate(`${year}-${month}-01`); // Primeiro dia do mês
      setMaxDate(`${year}-${month}-${lastDay}`); // Último dia do mês
      
      // Ajustar a data da transação para estar dentro do período
      const currentDate = new Date();
      const periodStartDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const periodEndDate = new Date(parseInt(year), parseInt(month) - 1, lastDay);
      
      // Se a data atual está dentro do período, use-a; senão, use o primeiro dia do período
      let defaultDate;
      if (currentDate >= periodStartDate && currentDate <= periodEndDate) {
        defaultDate = currentDate.toISOString().split('T')[0];
      } else {
        defaultDate = minDate;
      }
      
      setTransactionDate(defaultDate);
    }
  }, [selectedPeriod]);

  // Carregar períodos disponíveis
  const loadPeriods = async () => {
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
      let periodLabelToUse;
      
      if (savedPeriod && uniquePeriods.find(p => p.value === savedPeriod)) {
        // Se existir um período salvo e ele estiver disponível, usar ele
        periodToUse = savedPeriod;
        const savedPeriodObj = uniquePeriods.find(p => p.value === savedPeriod);
        periodLabelToUse = savedPeriodObj.label;
      } else if (uniquePeriods.length > 0) {
        // Caso contrário, usar o período mais recente
        periodToUse = uniquePeriods[0].value;
        periodLabelToUse = uniquePeriods[0].label;
        // Salvar no localStorage
        localStorage.setItem('selectedPeriod', periodToUse);
      }
      
      if (periodToUse) {
        setSelectedPeriod(periodToUse);
        setPeriodLabel(periodLabelToUse);
      }
    } catch (error) {
      console.error("Erro ao carregar períodos:", error);
      setError("Não foi possível carregar os períodos disponíveis.");
    }
  };

  // Carregar entradas de dinheiro quando o período selecionado mudar
  useEffect(() => {
    if (selectedPeriod) {
      loadCashEntries();
    }
  }, [selectedPeriod]);

  // Carregar entradas de dinheiro para o período selecionado
  const loadCashEntries = async () => {
    try {
      setLoading(true);
      
      if (!auth.currentUser || !selectedPeriod) return;
      
      // Consultar entradas de dinheiro para o período selecionado
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
          // Converter timestamp para objeto Date se necessário
          createdAt: doc.data().createdAt?.toDate() || new Date(),
          // Garantir que a data da transação esteja formatada
          transactionDate: doc.data().transactionDate || doc.data().createdAt?.toDate().toISOString().split('T')[0]
        });
      });
      
      setEntries(entriesList);
    } catch (error) {
      console.error("Erro ao carregar entradas de dinheiro:", error);
      setError("Não foi possível carregar as entradas de dinheiro para este período.");
    } finally {
      setLoading(false);
    }
  };

  // Função para alterar o período
  const handlePeriodChange = (event) => {
    const period = event.target.value;
    setSelectedPeriod(period);
    
    const selectedPeriodObj = periods.find(p => p.value === period);
    if (selectedPeriodObj) {
      setPeriodLabel(selectedPeriodObj.label);
    }
    
    // Salvar no localStorage
    localStorage.setItem('selectedPeriod', period);
    
    // Resetar formulário ao mudar de período
    resetForm();
  };

  // Função para resetar o formulário
  const resetForm = () => {
    setAmount("");
    setDescription("");
    // A data será atualizada automaticamente pelo efeito que observa selectedPeriod
    setIsEditing(false);
    setEditingEntryId(null);
  };

  // Função para enviar o formulário (adicionar/editar entrada)
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      setLoading(true);
      
      if (!auth.currentUser) throw new Error("Usuário não autenticado");
      if (!selectedPeriod) throw new Error("Selecione um período");
      if (!amount || isNaN(parseFloat(amount))) throw new Error("Digite um valor válido");
      if (!transactionDate) throw new Error("Selecione a data da transação");
      
      // Validar se a data está dentro do período
      if (transactionDate < minDate || transactionDate > maxDate) {
        throw new Error(`A data da transação deve estar dentro do período ${periodLabel}`);
      }
      
      // Preparar dados da entrada
      const numericAmount = parseFloat(amount);
      
      if (isEditing && editingEntryId) {
        // Atualizar entrada existente
        await updateDoc(doc(db, "cashEntries", editingEntryId), {
          amount: numericAmount,
          description: description.trim(),
          category: "Dinheiro",
          categoryPath: "RECEITA.Dinheiro",
          transactionDate: transactionDate,
          updatedAt: serverTimestamp()
        });
        
        setSuccess("Entrada atualizada com sucesso!");
      } else {
        // Adicionar nova entrada
        await addDoc(collection(db, "cashEntries"), {
          userId: auth.currentUser.uid,
          period: selectedPeriod,
          periodLabel: periodLabel,
          amount: numericAmount,
          description: description.trim(),
          category: "Dinheiro",
          categoryPath: "RECEITA.Dinheiro",
          transactionDate: transactionDate,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        
        setSuccess("Entrada de dinheiro adicionada com sucesso!");
      }
      
      // Recarregar entradas e resetar formulário
      await loadCashEntries();
      resetForm();
      
      // Limpar mensagem de sucesso após 3 segundos
      setTimeout(() => setSuccess(""), 3000);
    } catch (error) {
      console.error("Erro ao salvar entrada:", error);
      setError(error.message || "Não foi possível salvar a entrada de dinheiro.");
    } finally {
      setLoading(false);
    }
  };

  // Função para editar uma entrada
  const handleEdit = (entry) => {
    setAmount(entry.amount.toString());
    setDescription(entry.description || "");
    setTransactionDate(entry.transactionDate || minDate);
    setIsEditing(true);
    setEditingEntryId(entry.id);
    
    // Rolar para o formulário
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  };

  // Função para confirmar a exclusão de uma entrada
  const confirmDelete = (entry) => {
    setEntryToDelete(entry);
    setShowConfirmModal(true);
  };

  // Função para cancelar a exclusão
  const cancelDelete = () => {
    setShowConfirmModal(false);
    setEntryToDelete(null);
  };

  // Função para excluir uma entrada
  const handleDelete = async () => {
    if (!entryToDelete) return;
    
    try {
      setShowConfirmModal(false);
      setLoading(true);
      
      await deleteDoc(doc(db, "cashEntries", entryToDelete.id));
      
      setSuccess("Entrada removida com sucesso!");
      await loadCashEntries();
      
      // Limpar mensagem de sucesso após 3 segundos
      setTimeout(() => setSuccess(""), 3000);
    } catch (error) {
      console.error("Erro ao excluir entrada:", error);
      setError("Não foi possível excluir a entrada.");
    } finally {
      setLoading(false);
      setEntryToDelete(null);
    }
  };

  // Calcular total de entradas para o período selecionado
  const calculateTotal = () => {
    return entries.reduce((total, entry) => total + (entry.amount || 0), 0);
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
    if (!date) return "-";
    
    if (typeof date === 'string') {
      const [year, month, day] = date.split('-');
      return `${day}/${month}/${year}`;
    }
    
    return new Intl.DateTimeFormat('pt-BR').format(date);
  };

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
            <button className="close-button" onClick={() => setError("")}>×</button>
            {error}
          </div>
        )}
        
        {success && (
          <div className="success-message">
            <button className="close-button" onClick={() => setSuccess("")}>×</button>
            {success}
          </div>
        )}
        
        {loading && !selectedPeriod ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Carregando dados...</p>
          </div>
        ) : (
          <>
            {/* Formulário para adicionar/editar entrada */}
            <div className="cash-entry-form-card">
              <h2>{isEditing ? "Editar Entrada de Dinheiro" : "Adicionar Nova Entrada de Dinheiro"}</h2>
              
              <form onSubmit={handleSubmit} className="cash-entry-form">
                <div className="form-group">
                  <label htmlFor="amount">Valor (R$):</label>
                  <input
                    type="number"
                    id="amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Ex: 100.00"
                    min="0"
                    step="0.01"
                    required
                    disabled={loading}
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="transactionDate">Data da Entrada:</label>
                  <input
                    type="date"
                    id="transactionDate"
                    value={transactionDate}
                    onChange={(e) => setTransactionDate(e.target.value)}
                    min={minDate}
                    max={maxDate}
                    required
                    disabled={loading}
                  />
                  {minDate && maxDate && (
                    <small className="date-range-info">
                      Datas permitidas: {formatDate(minDate)} até {formatDate(maxDate)}
                    </small>
                  )}
                </div>
                
                <div className="form-group full-width">
                  <label htmlFor="description">Descrição:</label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrição opcional"
                    rows="3"
                    disabled={loading}
                  ></textarea>
                </div>
                
                <div className="form-actions">
                  {isEditing && (
                    <button
                      type="button"
                      className="cancel-button"
                      onClick={resetForm}
                      disabled={loading}
                    >
                      Cancelar
                    </button>
                  )}
                  
                  <button
                    type="submit"
                    className="submit-button"
                    disabled={loading || !amount}
                  >
                    {loading ? "Salvando..." : isEditing ? "Atualizar" : "Adicionar"}
                  </button>
                </div>
              </form>
            </div>
            
            {/* Lista de entradas para o período selecionado */}
            <div className="cash-entry-history-card">
              <h2>
                Entradas para {periodLabel}
                <span className="entries-total">
                  Total: {formatCurrency(calculateTotal())}
                </span>
              </h2>
              
              {loading ? (
                <div className="loading-container">
                  <div className="loading-spinner"></div>
                  <p>Carregando entradas...</p>
                </div>
              ) : entries.length === 0 ? (
                <div className="no-entries">
                  <p>Nenhuma entrada de dinheiro registrada para este período.</p>
                </div>
              ) : (
                <div className="entries-table-container">
                  <table className="entries-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Valor</th>
                        <th>Descrição</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.id}>
                          <td>{formatDate(entry.transactionDate)}</td>
                          <td className="amount-cell">{formatCurrency(entry.amount)}</td>
                          <td>{entry.description || "-"}</td>
                          <td className="action-buttons">
                            <button
                              className="edit-button"
                              onClick={() => handleEdit(entry)}
                              title="Editar"
                            >
                              ✎ Editar
                            </button>
                            <button
                              className="delete-button"
                              onClick={() => confirmDelete(entry)}
                              title="Excluir"
                            >
                              ✕ Excluir
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
        
        {/* Modal de confirmação de exclusão */}
        {showConfirmModal && (
          <div className="confirm-modal-overlay">
            <div className="confirm-modal">
              <div className="confirm-modal-header">
                <h3>Confirmar Exclusão</h3>
              </div>
              <div className="confirm-modal-content">
                <p>Tem certeza que deseja excluir esta entrada de dinheiro?</p>
                <p><strong>Valor:</strong> {formatCurrency(entryToDelete?.amount || 0)}</p>
                <p><strong>Data:</strong> {formatDate(entryToDelete?.transactionDate)}</p>
              </div>
              <div className="confirm-modal-footer">
                <button
                  className="cancel-modal-button"
                  onClick={cancelDelete}
                >
                  Cancelar
                </button>
                <button
                  className="confirm-modal-button"
                  onClick={handleDelete}
                >
                  Confirmar Exclusão
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