// src/components/Transactions/PreviousFiles.js
import React, { useState, useEffect } from "react";
import { auth, db, storage } from "../../firebase/config";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { ref, getBlob } from "firebase/storage";
import { parseOFXContent } from "../../utils/OFXParser";
import "./Transactions.css";

const PreviousFiles = ({ onFileSelected, onError }) => {
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [expandedDetails, setExpandedDetails] = useState(null);
  const [fetchingTransactions, setFetchingTransactions] = useState(false);

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
      
      // Query para buscar referências aos arquivos OFX do usuário
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
          filePath: data.filePath || null,
          fileURL: data.fileURL || null
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
      setFetchingTransactions(true);
      
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
      
      // Verificar se temos o caminho do arquivo no Storage
      if (!fileData.filePath) {
        throw new Error(
          "Este arquivo foi importado antes da atualização do sistema. " +
          "Por favor, importe o arquivo novamente."
        );
      }
      
      // Buscar o arquivo do Firebase Storage
      const storageRef = ref(storage, fileData.filePath);
      const blob = await getBlob(storageRef);
      
      // Converter o Blob para texto
      const fileContent = await blob.text();
      
      // Processar o conteúdo do arquivo OFX
      const transactions = parseOFXContent(fileContent);
      
      // Adicionar informações de período às transações
      const enhancedTransactions = transactions.map(transaction => ({
        ...transaction,
        period: fileData.period,
        periodLabel: fileData.periodLabel,
        month: fileData.month,
        year: fileData.year?.toString()
      }));
      
      // Chamar o callback com as transações carregadas e o ID do arquivo
      onFileSelected(enhancedTransactions, fileId);
    } catch (error) {
      console.error("Erro ao carregar transações do arquivo:", error);
      onError(`Erro ao carregar transações: ${error.message}`);
    } finally {
      setFetchingTransactions(false);
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
                    {file.filePath && (
                      <p><strong>Tipo:</strong> <span style={{color: '#4caf50'}}>Arquivo no Storage</span></p>
                    )}
                  </div>
                  <div className="file-actions">
                    <button 
                      className="load-file-button"
                      onClick={() => handleFileSelect(file.id)}
                      disabled={fetchingTransactions}
                    >
                      {fetchingTransactions ? "Carregando..." : "Carregar Transações"}
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