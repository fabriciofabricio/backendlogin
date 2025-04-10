// src/components/Transactions/PreviousFiles.js
import React, { useState, useEffect } from "react";
import { auth, db } from "../../firebase/config";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import "./Transactions.css";

const PreviousFiles = ({ onFileSelected, onError }) => {
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [expandedDetails, setExpandedDetails] = useState(null);

  useEffect(() => {
    loadPreviousFiles();
  }, []);

  const loadPreviousFiles = async () => {
    try {
      setLoading(true);
      
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setLoading(false);
        return;
      }
      
      // Query para buscar arquivos OFX do usuário
      const filesQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", currentUser.uid)
      );
      
      const filesSnapshot = await getDocs(filesQuery);
      
      if (filesSnapshot.empty) {
        setFiles([]);
        setLoading(false);
        return;
      }
      
      let filesData = [];
      filesSnapshot.forEach(doc => {
        const data = doc.data();
        filesData.push({
          id: doc.id,
          fileName: data.fileName || "Arquivo sem nome",
          uploadDate: data.uploadDate?.toDate() || new Date(),
          transactionCount: data.transactionCount || 0,
          period: data.period || "Não especificado",
          periodLabel: data.periodLabel || "Período não especificado",
          month: data.month,
          year: data.year,
          rawTransactions: data.rawTransactions || null // Guardar referência às transações brutas
        });
      });
      
      // Ordenar por data de upload (mais recente primeiro)
      filesData.sort((a, b) => b.uploadDate - a.uploadDate);
      
      setFiles(filesData);
    } catch (error) {
      console.error("Erro ao carregar arquivos anteriores:", error);
      onError("Não foi possível carregar arquivos anteriores. Tente novamente mais tarde.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (fileId) => {
    try {
      setLoading(true);
      
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Usuário não autenticado");
      }
      
      // Obter metadados do arquivo selecionado
      const fileDoc = await getDoc(doc(db, "ofxFiles", fileId));
      
      if (!fileDoc.exists()) {
        throw new Error("Arquivo não encontrado");
      }
      
      const fileData = fileDoc.data();
      
      // Verificar se o arquivo pertence ao usuário atual
      if (fileData.userId !== currentUser.uid) {
        throw new Error("Você não tem permissão para acessar este arquivo");
      }
      
      // Verificar se temos as transações brutas armazenadas no documento
      if (fileData.rawTransactions && Array.isArray(fileData.rawTransactions) && fileData.rawTransactions.length > 0) {
        console.log("Usando transações brutas armazenadas no documento do arquivo");
        
        // Usar as transações brutas armazenadas
        const transactions = fileData.rawTransactions.map(t => ({
          ...t,
          date: t.date instanceof Date ? t.date : new Date(t.date),
          period: fileData.period,
          periodLabel: fileData.periodLabel,
          month: fileData.month,
          year: fileData.year?.toString()
        }));
        
        // Chamar o callback com as transações carregadas e o ID do arquivo
        onFileSelected(transactions, fileId);
        setLoading(false);
        return;
      }
      
      // Se não temos transações brutas, tentar buscar transações já categorizadas
      const transactionsQuery = query(
        collection(db, "transactions"),
        where("fileId", "==", fileId),
        where("userId", "==", currentUser.uid)
      );
      
      const transactionsSnapshot = await getDocs(transactionsQuery);
      
      // Se não encontramos transações categorizadas
      if (transactionsSnapshot.empty) {
        throw new Error(
          "Não foram encontradas transações para este arquivo. Este arquivo foi importado " +
          "antes da atualização que armazena os dados brutos. Por favor, importe o arquivo novamente."
        );
      }
      
      // Convertendo dados do Firestore
      let transactions = [];
      
      transactionsSnapshot.forEach(doc => {
        const data = doc.data();
        transactions.push({
          id: data.transactionId || doc.id,
          date: data.date?.toDate() || new Date(),
          amount: data.amount || 0,
          description: data.description || "",
          category: data.category || null,
          categoryPath: data.categoryPath || null,
          period: data.period || fileData.period,
          periodLabel: data.periodLabel || fileData.periodLabel,
          month: data.month || fileData.month,
          year: data.year || fileData.year?.toString()
        });
      });
      
      // Chamar o callback com as transações carregadas e o ID do arquivo
      onFileSelected(transactions, fileId);
    } catch (error) {
      console.error("Erro ao carregar transações do arquivo:", error);
      onError(`Erro ao carregar transações: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleDetails = (fileId) => {
    if (expandedDetails === fileId) {
      setExpandedDetails(null);
    } else {
      setExpandedDetails(fileId);
    }
  };

  const formatDate = (date) => {
    return new Intl.DateTimeFormat('pt-BR', {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  };

  if (loading && files.length === 0) {
    return (
      <div className="previous-files-container">
        <h3>Arquivos Anteriores</h3>
        <div className="loading-message">Carregando arquivos...</div>
      </div>
    );
  }

  return (
    <div className="previous-files-container">
      <h3>Arquivos Anteriores</h3>
      
      {files.length === 0 ? (
        <div className="no-files-message">
          Você ainda não fez upload de nenhum arquivo OFX.
        </div>
      ) : (
        <div className="files-list">
          {files.map((file) => (
            <div key={file.id} className="file-item">
              <div className="file-header" onClick={() => toggleDetails(file.id)}>
                <div className="file-name">
                  <span className="file-icon">📄</span>
                  {file.fileName}
                </div>
                <div className="file-period">{file.periodLabel}</div>
                <div className="file-expand-icon">
                  {expandedDetails === file.id ? '▼' : '▶'}
                </div>
              </div>
              
              {expandedDetails === file.id && (
                <div className="file-details">
                  <div className="file-details-info">
                    <p><strong>Data de upload:</strong> {formatDate(file.uploadDate)}</p>
                    <p><strong>Número de transações:</strong> {file.transactionCount}</p>
                    <p><strong>Período:</strong> {file.periodLabel}</p>
                    {file.rawTransactions && (
                      <p><strong>Tipo:</strong> <span style={{color: '#4caf50'}}>Reprocessável</span></p>
                    )}
                  </div>
                  <div className="file-actions">
                    <button 
                      className="load-file-button"
                      onClick={() => handleFileSelect(file.id)}
                      disabled={loading}
                    >
                      {loading ? "Carregando..." : "Carregar Transações"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      
      <div className="refresh-files">
        <button 
          className="refresh-files-button"
          onClick={loadPreviousFiles}
          disabled={loading}
        >
          🔄 Atualizar Lista
        </button>
      </div>
    </div>
  );
};

export default PreviousFiles;